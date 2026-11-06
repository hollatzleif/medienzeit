// Kern der Medienzeit-Berechnung. Reine Funktion: Daten + "jetzt" → Zustand.
//
// Ablauf:
//  1. Basis-Fenster je Tag (Schultag/frei, früheste Startzeit, Endzeit, Tagesänderungen, Modus-B-Kürzungen)
//  2. ∩ Checkliste erledigt
//  3. − Pausen (Pausenregel aus der Laptop-Aktivität) − Sonderfreigaben  → "verbrauchbare" Zeit
//  4. Strafen-Warteschlange (FIFO) verbraucht Restminuten nur in verbrauchbarer Zeit → Sperren
//  5. erlaubt = (Basis − Pausen − Sperren) ∪ Sonderfreigaben

import { Iv, clip, contains, intersect, normalize, subtract, union } from './intervals';
import {
  MIN,
  addDays,
  dayEnd,
  dayStart,
  fmtMinutes,
  fmtWhen,
  localDate,
  weekdayOf,
  zonedToUtc,
} from './time';
import type {
  Activity,
  Adjustment,
  ChecklistEvent,
  ChecklistItem,
  Checkpoint,
  DayChange,
  Exam,
  Grant,
  Holiday,
  Kind,
  Penalty,
  Settings,
} from './types';

export interface EngineInput {
  now: number;
  settings: Settings;
  holidays: Holiday[];
  items: ChecklistItem[];
  checklistEvents: ChecklistEvent[];
  exams: Exam[];
  /** alle noch nicht abgegoltenen Strafen (dazu gern auch abgegoltene von heute) */
  penalties: Penalty[];
  adjustments: Adjustment[];
  dayChanges: DayChange[];
  grants: Grant[];
  activity: Activity[];
  checkpoint?: Checkpoint | null;
}

/**
 * real        = heute wie gespeichert, künftige Tage: Checkliste gilt als erledigt
 * hopeful     = wie real, aber eine heute offene Checkliste gilt ab jetzt als erledigt (für "wieder ab …")
 * pessimistic = künftige Tage: Checkliste gilt als offen (Offline-Plan des Laptops)
 */
export type Mode = 'real' | 'hopeful' | 'pessimistic';

export interface Segment {
  from: number;
  to: number;
  kind: Kind;
  allowed: boolean;
  lockId: string;
  text: string;
  penaltyId?: number;
}

export interface DayInfo {
  date: string;
  school: boolean;
  holiday: string | null;
  start: number;
  end: number;
  startTs: number;
  endTs: number;
}

export interface OpenPenalty {
  id: number;
  label: string;
  person: string;
  ts: number;
  minutes: number;
  mode: 'A' | 'B';
  remainingMinutes: number;
  /** Modus-B-Übertrag, der erst morgen beginnt */
  waitingUntil: number | null;
  /** voraussichtlich abgegolten um (falls Ludwig die Checkliste rechtzeitig macht) */
  endsAt: number | null;
}

interface Lock {
  from: number;
  to: number;
  id: number;
}

interface SweepResult {
  locks: Lock[];
  settleAt: Map<number, number>;
  snapshots: Map<number, Map<number, number>>;
}

const LOOKAHEAD_DAYS = 14;

export class Engine {
  readonly now: number;
  readonly today: string;
  readonly s: Settings;
  readonly from: number;
  readonly horizon: number;
  private readonly inp: EngineInput;
  private readonly memo = new Map<string, unknown>();

  constructor(inp: EngineInput) {
    this.inp = inp;
    this.now = inp.now;
    this.s = inp.settings;
    this.today = localDate(inp.now);
    let from = inp.now;
    const cp = inp.checkpoint;
    if (cp) from = Math.min(from, cp.ts);
    for (const p of inp.penalties) {
      if (!cp || p.ts >= cp.ts) from = Math.min(from, p.ts);
    }
    this.from = from;
    this.horizon = dayEnd(addDays(this.today, LOOKAHEAD_DAYS - 1));
  }

  private cached<T>(key: string, fn: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key) as T;
  }

  // ---------- Kalender ----------

  holidayOf(date: string): string | null {
    const h = this.inp.holidays.find((x) => x.from <= date && date <= x.to);
    return h ? h.label : null;
  }

  isSchoolDay(date: string): boolean {
    return this.cached(`school:${date}`, () => weekdayOf(date) <= 5 && !this.holidayOf(date));
  }

  applicableItems(date: string, at = Infinity): ChecklistItem[] {
    return this.cached(`items:${date}:${at}`, () =>
      this.inp.items.filter((it) => {
        switch (it.condition) {
          case 'always':
            return true;
          case 'school':
            return this.isSchoolDay(date);
          case 'tomorrowSchool':
            return this.isSchoolDay(addDays(date, 1));
          case 'study':
            return this.studyNeeded(date, at);
          default:
            return true;
        }
      }),
    );
  }

  /** Lernstunde nötig? Mit `at` zählen nur Klausuren/Tests, die zu dem Zeitpunkt schon eingetragen waren. */
  studyNeeded(date: string, at = Infinity): boolean {
    return this.inp.exams.some((e) => {
      if ((e.ts ?? 0) > at) return false;
      const lim = e.kind === 'klausur' ? this.s.examDays : this.s.testDays;
      return e.date > date && e.date <= addDays(date, lim);
    });
  }

  dayInfo(date: string): DayInfo {
    return this.cached(`day:${date}`, () => {
      const school = this.isSchoolDay(date);
      let start = school ? (this.s.earliestStart[String(weekdayOf(date))] ?? 720) : this.s.freeDayStart;
      let end = this.isSchoolDay(addDays(date, 1)) ? this.s.endBeforeSchool : this.s.endOtherwise;

      // Änderungen dieses Tages in zeitlicher Reihenfolge anwenden
      type Op = { ts: number; apply: () => void };
      const ops: Op[] = [];
      for (const c of this.inp.dayChanges) {
        if (c.date !== date) continue;
        ops.push({ ts: c.ts, apply: () => (c.kind === 'start' ? (start = c.minutes) : (end = c.minutes)) });
      }
      const bPen = new Map<number, Penalty>();
      for (const p of this.inp.penalties) {
        if (p.mode === 'B' && p.date === date && p.cut > 0) {
          bPen.set(p.id, p);
          ops.push({ ts: p.ts, apply: () => (end -= p.cut) });
        }
      }
      for (const a of this.inp.adjustments) {
        if (a.cutMinutes > 0 && bPen.has(a.penaltyId)) ops.push({ ts: a.ts, apply: () => (end += a.cutMinutes) });
      }
      ops.sort((x, y) => x.ts - y.ts).forEach((o) => o.apply());

      start = Math.max(0, Math.min(1440, start));
      end = Math.max(start, Math.min(1440, end));
      return {
        date,
        school,
        holiday: this.holidayOf(date),
        start,
        end,
        startTs: zonedToUtc(date, start),
        endTs: zonedToUtc(date, end),
      };
    });
  }

  private dates(): string[] {
    return this.cached('dates', () => {
      const out: string[] = [];
      const last = addDays(this.today, LOOKAHEAD_DAYS - 1);
      for (let d = localDate(this.from); d <= last; d = addDays(d, 1)) out.push(d);
      return out;
    });
  }

  windows(): Iv[] {
    return this.cached('windows', () => normalize(this.dates().map((d) => [this.dayInfo(d).startTs, this.dayInfo(d).endTs] as Iv)));
  }

  // ---------- Checkliste ----------

  checklistState(date: string): Map<number, boolean> {
    const state = new Map<number, boolean>();
    const evs = this.inp.checklistEvents.filter((e) => e.date === date).sort((a, b) => a.ts - b.ts);
    for (const e of evs) state.set(e.itemId, e.checked);
    return state;
  }

  checklistDoneNow(date = this.today): boolean {
    const st = this.checklistState(date);
    return this.applicableItems(date).every((i) => st.get(i.id));
  }

  /** Zeiträume eines Tages, in denen alle Punkte abgehakt waren / sind / angenommen werden. */
  checklistIv(date: string, mode: Mode): Iv[] {
    return this.cached(`cl:${date}:${mode}`, () => {
      const ds = dayStart(date);
      const de = dayEnd(date);
      if (!this.applicableItems(date).length) return [[ds, de]] as Iv[];
      if (date > this.today) return mode === 'pessimistic' ? [] : ([[ds, de]] as Iv[]);
      // Zeitpunkte, an denen sich etwas ändert: Abhaken/Abwählen und neu eingetragene Klausuren/Tests
      type Pt = { t: number; ev?: ChecklistEvent };
      const pts: Pt[] = [
        ...this.inp.checklistEvents.filter((e) => e.date === date).map((ev) => ({ t: ev.ts, ev })),
        ...this.inp.exams.filter((x) => x.ts !== undefined && x.ts > ds && x.ts < de).map((x) => ({ t: x.ts as number })),
      ].sort((a, b) => a.t - b.t);
      const state = new Map<number, boolean>();
      const doneAt = (t: number) => this.applicableItems(date, t).every((i) => state.get(i.id));
      const out: Iv[] = [];
      let open: number | null = doneAt(ds) ? ds : null;
      for (const pt of pts) {
        if (pt.ev) state.set(pt.ev.itemId, pt.ev.checked);
        const done = doneAt(pt.t);
        if (done && open === null) open = Math.max(pt.t, ds);
        else if (!done && open !== null) {
          out.push([open, pt.t]);
          open = null;
        }
      }
      if (open !== null) out.push([open, de]);
      else if (date === this.today && mode === 'hopeful') out.push([Math.max(this.now, ds), de]);
      return normalize(out);
    });
  }

  base(mode: Mode): Iv[] {
    return this.cached(`base:${mode}`, () =>
      union(...this.dates().map((d) => intersect([[this.dayInfo(d).startTs, this.dayInfo(d).endTs]], this.checklistIv(d, mode)))),
    );
  }

  grants(): Iv[] {
    return this.cached('grants', () => normalize(this.inp.grants.map((g) => [g.from, g.to] as Iv)));
  }

  // ---------- Pausenregel ----------

  pauseInfo(): { list: Iv[]; activeSoFar: number; active: boolean; predicted: Iv | null } {
    return this.cached('pause', () => {
      const A = this.s.pauseActiveMinutes * MIN;
      const B = this.s.pauseBreakMinutes * MIN;
      const P = this.s.pauseMinutes * MIN;
      const grants = this.grants();
      const shift = (t: number) => {
        for (const [a, b] of grants) if (a <= t && t < b) return b;
        return t;
      };
      const acts = normalize(this.inp.activity.map((a) => [a.from, Math.min(a.to, this.now)] as Iv));
      const list: Iv[] = [];
      let counter = 0;
      let lastEnd = -Infinity;
      for (const [a, b] of acts) {
        if (a - lastEnd >= B) counter = 0;
        let c = a;
        while (c < b) {
          const lp = list[list.length - 1];
          if (lp && c < lp[1]) {
            c = Math.min(b, lp[1]);
            continue;
          }
          if (counter + (b - c) >= A) {
            const t = shift(c + (A - counter));
            list.push([t, t + P]);
            counter = 0;
            c = t + P;
          } else {
            counter += b - c;
            c = b;
          }
        }
        lastEnd = Math.max(lastEnd, b, list.length ? list[list.length - 1][1] : -Infinity);
      }
      const inPause = contains(list, this.now);
      const lastAct = acts.length ? acts[acts.length - 1][1] : -Infinity;
      const activeSoFar = inPause || this.now - lastEnd >= B ? 0 : counter;
      const active = !inPause && lastAct >= this.now - 90_000;
      let predicted: Iv | null = null;
      if (active) {
        const t = shift(this.now + Math.max(0, A - activeSoFar));
        if (contains(this.base('real'), t)) predicted = [t, t + P];
      }
      return { list, activeSoFar, active, predicted };
    });
  }

  pauses(): Iv[] {
    const p = this.pauseInfo();
    return normalize(p.predicted ? [...p.list, p.predicted] : p.list);
  }

  // ---------- Strafen-Warteschlange ----------

  private entryOf(p: Penalty): number {
    return p.mode === 'A' ? p.ts : dayStart(addDays(p.date, 1));
  }

  private initialRemaining(p: Penalty): number {
    const cp = this.inp.checkpoint;
    if (cp && p.ts < cp.ts) return cp.remaining[String(p.id)] ?? 0;
    return (p.mode === 'A' ? p.minutes : p.carry) * MIN;
  }

  sweep(mode: Mode, marks: number[] = []): SweepResult {
    return this.cached(`sweep:${mode}:${marks.join(',')}`, () => {
      const cp = this.inp.checkpoint;
      const items = this.inp.penalties
        .map((p) => ({ p, entry: this.entryOf(p), remaining: this.initialRemaining(p) }))
        .sort((a, b) => a.entry - b.entry || a.p.ts - b.p.ts || a.p.id - b.p.id);
      const byId = new Map(items.map((i) => [i.p.id, i]));
      const adjs = this.inp.adjustments
        .filter((a) => (!cp || a.ts >= cp.ts) && a.queueMinutes > 0 && byId.has(a.penaltyId))
        .sort((a, b) => a.ts - b.ts);
      const sortedMarks = [...marks].sort((a, b) => a - b);
      const settleAt = new Map<number, number>();
      const snapshots = new Map<number, Map<number, number>>();
      for (const it of items) if (it.remaining <= 0) settleAt.set(it.p.id, this.from);

      let ai = 0;
      let mi = 0;
      const applyUntil = (t: number) => {
        for (;;) {
          const at = ai < adjs.length ? adjs[ai].ts : Infinity;
          const mt = mi < sortedMarks.length ? sortedMarks[mi] : Infinity;
          if (Math.min(at, mt) > t || (at === Infinity && mt === Infinity)) return;
          if (at <= mt) {
            const a = adjs[ai++];
            const it = byId.get(a.penaltyId)!;
            if (it.remaining > 0) {
              it.remaining = Math.max(0, it.remaining - a.queueMinutes * MIN);
              if (it.remaining === 0) settleAt.set(it.p.id, a.ts);
            }
          } else {
            snapshots.set(sortedMarks[mi++], new Map(items.map((i) => [i.p.id, i.remaining])));
          }
        }
      };
      const nextEventAfter = (c: number) => {
        let n = Infinity;
        if (ai < adjs.length) n = Math.min(n, adjs[ai].ts);
        if (mi < sortedMarks.length) n = Math.min(n, sortedMarks[mi]);
        for (const it of items) if (it.remaining > 0 && it.entry > c) n = Math.min(n, it.entry);
        return n;
      };

      const consumable = clip(subtract(this.base(mode), union(this.pauses(), this.grants())), this.from, this.horizon);
      const locks: Lock[] = [];
      for (const [a, b] of consumable) {
        let c = a;
        while (c < b) {
          applyUntil(c);
          const head = items.find((i) => i.entry <= c && i.remaining > 0);
          const next = Math.min(b, Math.max(c + 1, nextEventAfter(c)));
          if (!head) {
            c = next;
            continue;
          }
          const end = Math.min(next, c + head.remaining);
          const last = locks[locks.length - 1];
          if (last && last.id === head.p.id && last.to === c) last.to = end;
          else locks.push({ from: c, to: end, id: head.p.id });
          head.remaining -= end - c;
          if (head.remaining <= 0) settleAt.set(head.p.id, end);
          c = end;
        }
      }
      applyUntil(Infinity);
      return { locks, settleAt, snapshots };
    });
  }

  // ---------- Zeitleiste ----------

  allowedIv(mode: Mode): Iv[] {
    return this.cached(`allowed:${mode}`, () => {
      const locks = this.sweep(mode).locks.map((l) => [l.from, l.to] as Iv);
      return union(subtract(this.base(mode), union(this.pauses(), locks)), this.grants());
    });
  }

  nextAllowed(mode: Mode, t: number): number | null {
    for (const [a, b] of this.allowedIv(mode)) {
      if (b > t) return Math.max(a, t);
    }
    return null;
  }

  classify(mode: Mode, t: number): { kind: Kind; penaltyId?: number } {
    if (contains(this.grants(), t)) return { kind: 'grant' };
    const lock = this.sweep(mode).locks.find((l) => l.from <= t && t < l.to);
    if (lock) return { kind: 'penalty', penaltyId: lock.id };
    if (contains(this.pauses(), t)) return { kind: 'pause' };
    if (contains(this.base(mode), t)) return { kind: 'allowed' };
    if (contains(this.windows(), t)) return { kind: 'checklist' };
    return { kind: 'schedule' };
  }

  timeline(mode: Mode, from: number, to: number, textMode: Mode = mode): Segment[] {
    const pts = new Set<number>([from, to]);
    const add = (ivs: Iv[]) => ivs.forEach(([a, b]) => [a, b].forEach((x) => x > from && x < to && pts.add(x)));
    add(this.windows());
    add(this.base(mode));
    add(this.pauses());
    add(this.grants());
    add(this.sweep(mode).locks.map((l) => [l.from, l.to] as Iv));
    const sorted = [...pts].sort((a, b) => a - b);
    const segs: Segment[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const [a, b] = [sorted[i], sorted[i + 1]];
      const c = this.classify(mode, a);
      const last = segs[segs.length - 1];
      if (last && last.kind === c.kind && last.penaltyId === c.penaltyId) last.to = b;
      else
        segs.push({
          from: a,
          to: b,
          kind: c.kind,
          allowed: c.kind === 'allowed' || c.kind === 'grant',
          lockId: '',
          text: '',
          penaltyId: c.penaltyId,
        });
    }
    for (const seg of segs) {
      seg.lockId = seg.kind === 'penalty' ? `p:${seg.penaltyId}` : `${seg.kind}:${seg.from}`;
      seg.text = this.textFor(seg, textMode);
    }
    return segs;
  }

  penaltyById(id: number | undefined): Penalty | undefined {
    return this.inp.penalties.find((p) => p.id === id);
  }

  textFor(seg: Segment, mode: Mode): string {
    const now = Math.max(this.now, seg.from);
    switch (seg.kind) {
      case 'allowed':
        return `Darf bis ${fmtWhen(seg.to, this.now)}`;
      case 'grant':
        return `Sonderfreigabe bis ${fmtWhen(seg.to, this.now)}`;
      case 'pause':
        return `Pause bis ${fmtWhen(seg.to, this.now)}`;
      case 'checklist': {
        const open = this.openPenaltyMinutes();
        return open > 0 ? `Checkliste noch offen – danach noch ${fmtMinutes(open)} Strafe` : 'Checkliste noch offen';
      }
      case 'penalty': {
        const p = this.penaltyById(seg.penaltyId);
        const why = p ? ` – ${p.label} (${p.person})` : '';
        const next = this.nextAllowed(mode, now);
        return next ? `Gesperrt bis ${fmtWhen(next, this.now)}${why}` : `Gesperrt${why}`;
      }
      case 'schedule': {
        const next = this.nextAllowed(mode, now);
        if (!next) return 'Sperrzeit';
        const d = localDate(next);
        const needsList =
          this.applicableItems(d).length > 0 && (d > this.today || !this.checklistDoneNow()) && !contains(this.grants(), next);
        return `Sperrzeit – wieder ab ${fmtWhen(next, this.now)}${needsList ? ' (mit erledigter Checkliste)' : ''}`;
      }
    }
  }

  openPenaltyMinutes(): number {
    let ms = 0;
    for (const v of this.remainingAtNow().values()) ms += v;
    return Math.ceil(ms / MIN);
  }

  remainingAtNow(): Map<number, number> {
    const snap = this.sweep('real', [this.now]).snapshots.get(this.now);
    return snap ?? new Map();
  }

  // ---------- Ergebnis ----------

  openPenalties(): OpenPenalty[] {
    const rem = this.remainingAtNow();
    const hopeful = this.sweep('hopeful');
    return this.inp.penalties
      .filter((p) => (rem.get(p.id) ?? 0) > 0)
      .sort((a, b) => this.entryOf(a) - this.entryOf(b) || a.ts - b.ts)
      .map((p) => {
        const entry = this.entryOf(p);
        return {
          id: p.id,
          label: p.label,
          person: p.person,
          ts: p.ts,
          minutes: p.minutes,
          mode: p.mode,
          remainingMinutes: Math.ceil((rem.get(p.id) ?? 0) / MIN),
          waitingUntil: entry > this.now ? entry : null,
          endsAt: hopeful.settleAt.get(p.id) ?? null,
        };
      });
  }

  /** Zwischenstand für den Tagesbeginn, falls es einen neuen braucht. */
  checkpointCandidate(): { checkpoint: Checkpoint; settledIds: number[] } | null {
    const t = dayStart(this.today);
    if (t <= this.from || (this.inp.checkpoint && this.inp.checkpoint.ts >= t)) return null;
    const snap = this.sweep('real', [t]).snapshots.get(t);
    if (!snap) return null;
    const remaining: Record<string, number> = {};
    const settledIds: number[] = [];
    for (const p of this.inp.penalties) {
      if (p.ts >= t) continue;
      const r = snap.get(p.id) ?? 0;
      if (r > 0) remaining[String(p.id)] = r;
      else settledIds.push(p.id);
    }
    return { checkpoint: { ts: t, remaining }, settledIds };
  }

  status() {
    const segs = this.timeline('real', this.now, this.horizon, 'hopeful');
    const seg = segs[0];
    let until: number | null = null;
    if (seg.kind === 'allowed' || seg.kind === 'grant' || seg.kind === 'pause') until = seg.to;
    else if (seg.kind === 'penalty' || seg.kind === 'schedule') until = this.nextAllowed('hopeful', this.now);
    return {
      kind: seg.kind,
      allowed: seg.allowed,
      text: seg.text,
      until,
      lockId: seg.lockId,
      penaltyId: seg.penaltyId ?? null,
    };
  }

  /** Vorsichtiger 24-Stunden-Plan für den Laptop. */
  plan(): Segment[] {
    const segs = this.timeline('pessimistic', this.now, this.now + 24 * 3_600_000);
    const st = this.status();
    if (segs.length) segs[0].text = st.text;
    return segs;
  }

  /** Modus B: wie viel wird heute gekürzt, wie viel geht auf morgen? */
  modeBSplit(minutes: number): { cut: number; carry: number } {
    const d = this.dayInfo(this.today);
    const remainingMs = Math.max(0, d.endTs - Math.max(this.now, d.startTs));
    const cut = Math.min(minutes, Math.ceil(remainingMs / MIN));
    return { cut, carry: minutes - cut };
  }

  /** Verringerung einer Strafe aufteilen (Warteschlange zuerst, dann heutige Modus-B-Kürzung). */
  reductionSplit(p: Penalty, minutes: number | null): { queueMinutes: number; cutMinutes: number } {
    const remQueue = Math.ceil((this.remainingAtNow().get(p.id) ?? 0) / MIN);
    const want = minutes === null ? Infinity : minutes;
    const queueMinutes = Math.min(want, remQueue);
    let cutMinutes = 0;
    if (p.mode === 'B' && p.date === this.today) {
      const already = this.inp.adjustments.filter((a) => a.penaltyId === p.id).reduce((s, a) => s + a.cutMinutes, 0);
      cutMinutes = Math.max(0, Math.min(want - queueMinutes, p.cut - already));
    }
    return { queueMinutes, cutMinutes };
  }

  checklistView() {
    const st = this.checklistState(this.today);
    const items = this.applicableItems(this.today).map((i) => ({ id: i.id, label: i.label, checked: !!st.get(i.id) }));
    return { date: this.today, items, done: items.every((i) => i.checked) };
  }

  upcomingDays(n = 7): DayInfo[] {
    const out: DayInfo[] = [];
    for (let i = 0; i < n; i++) out.push(this.dayInfo(addDays(this.today, i)));
    return out;
  }

  pauseView() {
    const p = this.pauseInfo();
    const cur = p.list.find(([a, b]) => a <= this.now && this.now < b);
    return {
      activeSoFarMinutes: Math.floor(p.activeSoFar / MIN),
      active: p.active,
      pauseUntil: cur ? cur[1] : null,
      nextPauseAt: p.predicted ? p.predicted[0] : null,
    };
  }
}
