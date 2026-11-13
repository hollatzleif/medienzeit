export interface Settings {
  /** früheste Startzeit an Schultagen je Wochentag ("1" = Montag … "5" = Freitag), Minuten seit Mitternacht */
  earliestStart: Record<string, number>;
  /** Start an freien Tagen (Wochenende, Ferien, Feiertage) */
  freeDayStart: number;
  /** Ende, wenn der nächste Tag ein Schultag ist */
  endBeforeSchool: number;
  /** Ende sonst */
  endOtherwise: number;
  pauseActiveMinutes: number;
  pauseBreakMinutes: number;
  pauseMinutes: number;
  offlineMinutes: number;
  warnMinutes: number;
  /** Lernstunde, wenn eine Klausur in so vielen Tagen ansteht */
  examDays: number;
  /** Lernstunde, wenn ein Test in so vielen Tagen ansteht */
  testDays: number;
  /** Bewertung des morgendlichen Benehmens ist Pflicht, bevor die Medienzeit beginnt */
  ratingRequired: boolean;
  /** ab diesem Tag gilt die Pflicht (YYYY-MM-DD; leer = immer) */
  ratingFrom: string;
  /** Abzug in Minuten: 6–7 Punkte, 3–5 Punkte, 1–2 Punkte (8–10 = kein Abzug) */
  ratingMinutes: { ok: number; bad: number; worst: number };
  /** Tageskonto: maximale Laptop-Zeit in Minuten (0 = keine Grenze) */
  budget: { school: number; weekend: number; holiday: number };
}

export const DEFAULT_SETTINGS: Settings = {
  earliestStart: { '1': 720, '2': 720, '3': 720, '4': 720, '5': 720 },
  freeDayStart: 690,
  endBeforeSchool: 1200,
  endOtherwise: 1290,
  pauseActiveMinutes: 180,
  pauseBreakMinutes: 30,
  pauseMinutes: 30,
  offlineMinutes: 240,
  warnMinutes: 5,
  examDays: 7,
  testDays: 3,
  ratingRequired: true,
  ratingFrom: '',
  ratingMinutes: { ok: 30, bad: 60, worst: 120 },
  budget: { school: 180, weekend: 300, holiday: 300 },
};

/** Abzug für eine Bewertung von 1–10 */
export function ratingPenaltyMinutes(s: Settings, score: number): number {
  if (score >= 8) return 0;
  if (score >= 6) return s.ratingMinutes.ok;
  if (score >= 3) return s.ratingMinutes.bad;
  return s.ratingMinutes.worst;
}

export interface Rating {
  date: string;
  ts: number;
  score: number;
  person: string;
}

export interface Holiday {
  id?: number;
  from: string;
  to: string;
  label: string;
}

/** always = jeden Tag, school = nur Schultage, study = nur bei Klausur/Test, tomorrowSchool = nur wenn morgen Schule */
export type ItemCondition = 'always' | 'school' | 'study' | 'tomorrowSchool';

export interface ChecklistItem {
  id: number;
  label: string;
  condition: ItemCondition;
  sort: number;
  active?: boolean;
}

export interface ChecklistEvent {
  date: string;
  itemId: number;
  checked: boolean;
  ts: number;
}

export interface Exam {
  id: number;
  date: string;
  kind: 'klausur' | 'test';
  subject: string;
  /** Zeitpunkt des Eintragens – die Lernstunde gilt erst ab dann (nicht rückwirkend) */
  ts?: number;
}

export interface Penalty {
  id: number;
  ts: number;
  person: string;
  label: string;
  minutes: number;
  /** A = Sofort, B = Heute früher Schluss, C = vom Tageskonto */
  mode: 'A' | 'B' | 'C';
  /** lokales Datum beim Eintragen */
  date: string;
  /** Modus B: so viele Minuten wurden heute vom Ende abgezogen */
  cut: number;
  /** Modus B: so viele Minuten gehen als Sofort-Strafe auf den nächsten Tag */
  carry: number;
}

export interface Adjustment {
  id: number;
  ts: number;
  penaltyId: number;
  /** Verringerung der Restminuten in der Warteschlange */
  queueMinutes: number;
  /** Modus B: Verringerung der heutigen Kürzung */
  cutMinutes: number;
}

export interface DayChange {
  id: number;
  ts: number;
  date: string;
  /** start/end = Uhrzeit (Minuten), bonus = zusätzliche Laptop-Zeit (Minuten) */
  kind: 'start' | 'end' | 'bonus';
  minutes: number;
}

export interface Grant {
  id: number;
  from: number;
  to: number;
  person: string;
  reason: string;
}

export interface Activity {
  from: number;
  to: number;
}

export interface Checkpoint {
  ts: number;
  /** Penalty-ID → Restzeit in Millisekunden */
  remaining: Record<string, number>;
}

export type Kind = 'allowed' | 'grant' | 'penalty' | 'pause' | 'budget' | 'checklist' | 'schedule';
