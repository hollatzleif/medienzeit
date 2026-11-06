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
};

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
  mode: 'A' | 'B';
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
  kind: 'start' | 'end';
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

export type Kind = 'allowed' | 'grant' | 'penalty' | 'pause' | 'checklist' | 'schedule';
