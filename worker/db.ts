// Laden der Daten aus D1 und Aufbau der Engine.

import { Engine, EngineInput } from './engine/engine';
import { addDays, dayStart, localDate } from './engine/time';
import {
  DEFAULT_SETTINGS,
  type Adjustment,
  type ChecklistEvent,
  type ChecklistItem,
  type Checkpoint,
  type DayChange,
  type Exam,
  type Grant,
  type Holiday,
  type ItemCondition,
  type Penalty,
  type Settings,
} from './engine/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LUDWIG_TOKEN: string;
  PARENT_TOKEN: string;
  DEVICE_TOKEN: string;
  /** "Mama:1234, Papa:5678, Leif:…" */
  PINS: string;
}

export interface CatalogEntry {
  id: number;
  label: string;
  logText: string;
  minutes: number;
  special: string | null;
  hint: string | null;
  sort: number;
}

export interface Loaded {
  engine: Engine;
  input: EngineInput;
  settings: Settings;
  catalog: CatalogEntry[];
  allItems: ChecklistItem[];
  holidays: Holiday[];
  exams: Exam[];
  device: DeviceInfo | null;
}

export interface DeviceInfo {
  lastPoll: number;
  session: string;
  agentVersion?: string;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v);
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function parseSettings(raw: string | null | undefined): Settings {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...v, earliestStart: { ...DEFAULT_SETTINGS.earliestStart, ...(v.earliestStart ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const rowToPenalty = (r: Row): Penalty => ({
  id: n(r.id),
  ts: n(r.ts),
  person: s(r.person),
  label: s(r.label),
  minutes: n(r.minutes),
  mode: r.mode === 'B' ? 'B' : 'A',
  date: s(r.date),
  cut: n(r.cut),
  carry: n(r.carry),
});

export async function load(env: Env, now: number): Promise<Loaded> {
  const db = env.DB;
  const [setRows, penRows, holRows, itemRows, catRows] = await db.batch([
    db.prepare("SELECT key, value FROM settings WHERE key IN ('main','checkpoint','device')"),
    db.prepare('SELECT * FROM penalties WHERE settled = 0 ORDER BY ts'),
    db.prepare('SELECT * FROM holidays ORDER BY date_from'),
    db.prepare('SELECT * FROM checklist_items ORDER BY sort, id'),
    db.prepare('SELECT * FROM catalog WHERE active = 1 ORDER BY sort, id'),
  ]);
  const kv = new Map((setRows.results as Row[]).map((r) => [s(r.key), s(r.value)]));
  const settings = parseSettings(kv.get('main'));
  let checkpoint: Checkpoint | null = null;
  try {
    checkpoint = kv.get('checkpoint') ? JSON.parse(kv.get('checkpoint')!) : null;
  } catch {
    checkpoint = null;
  }
  let device: DeviceInfo | null = null;
  try {
    device = kv.get('device') ? JSON.parse(kv.get('device')!) : null;
  } catch {
    device = null;
  }
  const penalties = (penRows.results as Row[]).map(rowToPenalty);

  // Ab wann muss gerechnet werden?
  let from = now;
  if (checkpoint) from = Math.min(from, checkpoint.ts);
  for (const p of penalties) if (!checkpoint || p.ts >= checkpoint.ts) from = Math.min(from, p.ts);
  const fromDate = localDate(from);
  const today = localDate(now);
  const loadFrom = Math.min(from, dayStart(today));
  const loadFromDate = localDate(loadFrom);

  const [evRows, exRows, dcRows, grRows, actRows, adjRows, ratRows] = await db.batch([
    db.prepare('SELECT date, item_id, checked, ts FROM checklist_events WHERE date >= ? ORDER BY ts').bind(loadFromDate),
    db.prepare('SELECT * FROM exams WHERE date >= ? ORDER BY date').bind(addDays(fromDate, -1)),
    db.prepare('SELECT * FROM day_changes WHERE date >= ? ORDER BY ts').bind(loadFromDate),
    db.prepare('SELECT * FROM grants WHERE to_ts >= ? ORDER BY from_ts').bind(loadFrom),
    db.prepare('SELECT from_ts, to_ts FROM activity WHERE to_ts >= ? ORDER BY from_ts').bind(loadFrom - 12 * 3_600_000),
    db.prepare('SELECT * FROM adjustments WHERE ts >= ? ORDER BY ts').bind(checkpoint ? checkpoint.ts : 0),
    db.prepare('SELECT date, ts, score, person FROM ratings WHERE date >= ? ORDER BY ts').bind(loadFromDate),
  ]);

  const allItems: ChecklistItem[] = (itemRows.results as Row[]).map((r) => ({
    id: n(r.id),
    label: s(r.label),
    condition: s(r.condition) as ItemCondition,
    sort: n(r.sort),
    active: n(r.active) === 1,
  }));
  const items = allItems.filter((i) => i.active);
  const holidays: Holiday[] = (holRows.results as Row[]).map((r) => ({ id: n(r.id), from: s(r.date_from), to: s(r.date_to), label: s(r.label) }));
  const exams: Exam[] = (exRows.results as Row[]).map((r) => ({
    id: n(r.id),
    date: s(r.date),
    kind: r.kind === 'test' ? 'test' : 'klausur',
    subject: s(r.subject),
    ts: n(r.ts),
  }));
  const penIds = new Set(penalties.map((p) => p.id));

  const input: EngineInput = {
    now,
    settings,
    holidays,
    items,
    checklistEvents: (evRows.results as Row[]).map(
      (r): ChecklistEvent => ({ date: s(r.date), itemId: n(r.item_id), checked: n(r.checked) === 1, ts: n(r.ts) }),
    ),
    exams,
    penalties,
    adjustments: (adjRows.results as Row[])
      .map((r): Adjustment => ({
        id: n(r.id),
        ts: n(r.ts),
        penaltyId: n(r.penalty_id),
        queueMinutes: n(r.queue_minutes),
        cutMinutes: n(r.cut_minutes),
      }))
      .filter((a) => penIds.has(a.penaltyId)),
    dayChanges: (dcRows.results as Row[]).map(
      (r): DayChange => ({ id: n(r.id), ts: n(r.ts), date: s(r.date), kind: r.kind === 'start' ? 'start' : 'end', minutes: n(r.minutes) }),
    ),
    grants: (grRows.results as Row[]).map(
      (r): Grant => ({ id: n(r.id), from: n(r.from_ts), to: n(r.to_ts), person: s(r.person), reason: s(r.reason) }),
    ),
    activity: (actRows.results as Row[]).map((r) => ({ from: n(r.from_ts), to: n(r.to_ts) })),
    checkpoint,
    ratings: (ratRows.results as Row[]).map((r) => ({ date: s(r.date), ts: n(r.ts), score: n(r.score), person: s(r.person) })),
  };

  const catalog: CatalogEntry[] = (catRows.results as Row[]).map((r) => ({
    id: n(r.id),
    label: s(r.label),
    logText: s(r.log_text),
    minutes: n(r.minutes),
    special: r.special ? s(r.special) : null,
    hint: r.hint ? s(r.hint) : null,
    sort: n(r.sort),
  }));

  return { engine: new Engine(input), input, settings, catalog, allItems, holidays, exams, device };
}

/** Schreibt einen neuen Zwischenstand, damit die Rechnung kurz bleibt. */
export async function maybeCheckpoint(env: Env, l: Loaded): Promise<void> {
  const c = l.engine.checkpointCandidate();
  if (!c) return;
  const stmts = [
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('checkpoint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(
      JSON.stringify(c.checkpoint),
    ),
  ];
  if (c.settledIds.length) {
    stmts.push(env.DB.prepare(`UPDATE penalties SET settled = 1 WHERE id IN (${c.settledIds.map(() => '?').join(',')})`).bind(...c.settledIds));
  }
  // alte Aktivität aufräumen (älter als 30 Tage)
  stmts.push(env.DB.prepare('DELETE FROM activity WHERE to_ts < ?').bind(l.engine.now - 30 * 86_400_000));
  await env.DB.batch(stmts);
}

export async function addLog(env: Env, ts: number, person: string | null, kind: string, text: string, minutes: number | null = null) {
  await env.DB.prepare('INSERT INTO log (ts, person, kind, text, minutes) VALUES (?, ?, ?, ?, ?)').bind(ts, person, kind, text, minutes).run();
}

export function logStmt(env: Env, ts: number, person: string | null, kind: string, text: string, minutes: number | null = null) {
  return env.DB.prepare('INSERT INTO log (ts, person, kind, text, minutes) VALUES (?, ?, ?, ?, ?)').bind(ts, person, kind, text, minutes);
}

export function parsePins(raw: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (raw ?? '').split(/[,;\n]/)) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const pin = part.slice(i + 1).trim();
    if (name && pin) m.set(name, pin);
  }
  return m;
}
