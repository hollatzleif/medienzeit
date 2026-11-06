// Zeit-Helfer für Europe/Zurich. Gespeichert wird immer in UTC (Millisekunden),
// gerechnet wird in lokalen Kalendertagen ("YYYY-MM-DD") und Minuten seit Mitternacht.

export const TZ = 'Europe/Zurich';
export const MIN = 60_000;
export const HOUR = 3_600_000;

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

// Der Zeitzonen-Versatz ändert sich nur zu vollen UTC-Stunden, also cachen wir pro Stunde.
const offCache = new Map<number, number>();

export function tzOffset(ts: number): number {
  const key = Math.floor(ts / HOUR);
  let o = offCache.get(key);
  if (o === undefined) {
    const p: Record<string, number> = {};
    for (const part of dtf.formatToParts(new Date(key * HOUR))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
    o = asUtc - key * HOUR;
    if (offCache.size > 20000) offCache.clear();
    offCache.set(key, o);
  }
  return o;
}

export interface LocalParts {
  date: string; // YYYY-MM-DD
  weekday: number; // 1 = Montag … 7 = Sonntag
  minutes: number; // Minuten seit Mitternacht
}

export function localParts(ts: number): LocalParts {
  const d = new Date(ts + tzOffset(ts));
  return {
    date: d.toISOString().slice(0, 10),
    weekday: ((d.getUTCDay() + 6) % 7) + 1,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export const localDate = (ts: number) => localParts(ts).date;

/** Lokale Uhrzeit eines Tages → UTC. Bei der Lücke im März gilt der spätere Zeitpunkt. */
export function zonedToUtc(date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number);
  const g = Date.UTC(y, m - 1, d) + minutes * MIN;
  const t1 = g - tzOffset(g);
  if (t1 + tzOffset(t1) === g) return t1;
  const t2 = g - tzOffset(t1);
  if (t2 + tzOffset(t2) === g) return t2;
  return Math.max(t1, t2);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

export const dayStart = (date: string) => zonedToUtc(date, 0);
export const dayEnd = (date: string) => zonedToUtc(addDays(date, 1), 0);

// ---------- Formatierung (deutsch) ----------

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const pad = (n: number) => String(n).padStart(2, '0');

export function hm(ts: number): string {
  const p = localParts(ts);
  return `${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`;
}

export function minToHm(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function hmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 ? v : null;
}

/** "05.11.26" */
export function dmy(ts: number): string {
  const [y, m, d] = localDate(ts).split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

/** "Sa 07.11." aus einem Datum */
export function dateLabel(date: string): string {
  const [, m, d] = date.split('-');
  return `${WD_SHORT[weekdayOf(date) - 1]} ${d}.${m}.`;
}

/** Relativ zu "jetzt": "15:30", "morgen 13:30", "Samstag 11:30", "Sa 14.11. 11:30" */
export function fmtWhen(ts: number, now: number): string {
  const today = localDate(now);
  const d = localDate(ts);
  if (d === today) return hm(ts);
  if (d === addDays(today, 1)) return `morgen ${hm(ts)}`;
  if (d > today && d <= addDays(today, 6)) return `${WEEKDAYS[weekdayOf(d) - 1]} ${hm(ts)}`;
  return `${dateLabel(d)} ${hm(ts)}`;
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} Std. ${r} Min.` : `${h} Std.`;
}
