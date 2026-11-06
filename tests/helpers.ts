import { Engine, EngineInput } from '../worker/engine/engine';
import { hm, localDate, zonedToUtc } from '../worker/engine/time';
import { DEFAULT_SETTINGS, type ChecklistEvent, type ChecklistItem, type Penalty } from '../worker/engine/types';

/** Lokale Zeit → UTC-ms. at('2026-11-09', '14:30') */
export const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedToUtc(date, h * 60 + m);
};

export const ITEMS: ChecklistItem[] = [
  { id: 1, label: 'Zimmer aufgeräumt', condition: 'always', sort: 1 },
  { id: 2, label: 'Hausaufgaben gemacht', condition: 'always', sort: 2 },
  { id: 3, label: 'Lernstunde erledigt', condition: 'study', sort: 3 },
  { id: 4, label: 'Schulranzen gepackt und Anziehstuhl vorbereitet', condition: 'tomorrowSchool', sort: 4 },
];

/** Hakt alle Punkte ab (auch die, die an dem Tag gar nicht gelten – schadet nicht). */
export const checkAll = (date: string, time: string): ChecklistEvent[] =>
  ITEMS.map((i) => ({ date, itemId: i.id, checked: true, ts: at(date, time) }));

export const uncheckAll = (date: string, time: string): ChecklistEvent[] =>
  ITEMS.map((i) => ({ date, itemId: i.id, checked: false, ts: at(date, time) }));

let pid = 1;
export function penalty(ts: number, minutes: number, label = 'Rumschreien', person = 'Papa', extra: Partial<Penalty> = {}): Penalty {
  return { id: pid++, ts, person, label, minutes, mode: 'A', date: localDate(ts), cut: 0, carry: 0, ...extra };
}

export function input(now: number, over: Partial<EngineInput> = {}): EngineInput {
  return {
    now,
    settings: DEFAULT_SETTINGS,
    holidays: [],
    items: ITEMS,
    checklistEvents: [],
    exams: [],
    penalties: [],
    adjustments: [],
    dayChanges: [],
    grants: [],
    activity: [],
    checkpoint: null,
    ...over,
  };
}

export const engine = (now: number, over: Partial<EngineInput> = {}) => new Engine(input(now, over));

/** Nächster erlaubter Zeitpunkt als "Datum Uhrzeit" */
export function nextAllowedLocal(e: Engine, mode: 'real' | 'hopeful' = 'real'): string | null {
  const t = e.nextAllowed(mode, e.now);
  return t === null ? null : `${localDate(t)} ${hm(t)}`;
}
