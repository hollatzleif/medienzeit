// Aktionen der Eltern-Ansicht und der Ludwig-Ansicht.

import { addLog, logStmt, type CatalogEntry, type Env, type Loaded } from './db';
import { Engine } from './engine/engine';
import { contains } from './engine/intervals';
import { addDays, dateLabel, fmtMinutes, fmtWhen, hm, hmToMin, minToHm } from './engine/time';
import { ratingPenaltyMinutes, type ChecklistEvent, type ItemCondition, type Penalty, type Rating, type Settings } from './engine/types';
import type { EngineInput } from './engine/engine';

export class UserError extends Error {}

const uhr = (s: string) => `${s} Uhr`;

// ---------- Strafen ----------

export interface PenaltyPlan {
  penalty: Penalty;
  resetEvents: ChecklistEvent[];
  text: string;
}

export function planPenalty(l: Loaded, cat: CatalogEntry, modeIn: 'A' | 'B', person: string, extra: Partial<EngineInput> = {}): PenaltyPlan {
  const e = l.engine;
  const now = e.now;
  const reset = cat.special === 'reset_checklist';
  const mode = reset ? 'A' : modeIn;
  const split = mode === 'B' ? e.modeBSplit(cat.minutes) : { cut: 0, carry: 0 };
  const penalty: Penalty = { id: -1, ts: now, person, label: cat.label, minutes: cat.minutes, mode, date: e.today, ...split };

  const state = e.checklistState(e.today);
  const resetEvents: ChecklistEvent[] = reset
    ? e
        .applicableItems(e.today)
        .filter((i) => state.get(i.id))
        .map((i) => ({ date: e.today, itemId: i.id, checked: false, ts: now }))
    : [];

  const after = new Engine({
    ...l.input,
    ...extra,
    penalties: [...l.input.penalties, penalty],
    checklistEvents: [...l.input.checklistEvents, ...resetEvents],
  });

  let text: string;
  if (reset) {
    text = `Laptop gesperrt, bis die Checkliste wieder erledigt ist – danach noch ${fmtMinutes(cat.minutes)}`;
  } else if (mode === 'A') {
    const next = after.nextAllowed('hopeful', now);
    const inGrant = contains(after.grants(), now);
    const kindBefore = e.status().kind;
    if (inGrant) text = `Strafe läuft nach der Sonderfreigabe (${fmtMinutes(cat.minutes)})`;
    else if (kindBefore === 'allowed' || kindBefore === 'penalty') text = next ? `Laptop gesperrt bis ${uhr(fmtWhen(next, now))}` : 'Laptop gesperrt';
    else text = next ? `Medien erst ab ${uhr(fmtWhen(next, now))}` : `${fmtMinutes(cat.minutes)} Abzug von der nächsten Medienzeit`;
  } else {
    const d = after.dayInfo(e.today);
    const carry = split.carry ? `, ${fmtMinutes(split.carry)} werden morgen am Anfang abgezogen` : '';
    if (split.cut === 0) text = `heute keine Medienzeit mehr${carry}`;
    else if (d.endTs <= now) text = `Medienzeit endet sofort${carry}`;
    else text = `Medienzeit endet heute um ${uhr(hm(d.endTs))}`;
  }
  if (cat.hint) text += ` (Hinweis: ${cat.hint})`;
  return { penalty, resetEvents, text };
}

export async function createPenalty(env: Env, l: Loaded, cat: CatalogEntry, mode: 'A' | 'B', person: string) {
  const plan = planPenalty(l, cat, mode, person);
  const p = plan.penalty;
  const stmts = [
    env.DB.prepare(
      'INSERT INTO penalties (ts, person, catalog_id, label, minutes, mode, date, cut, carry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(p.ts, p.person, cat.id, p.label, p.minutes, p.mode, p.date, p.cut, p.carry),
    ...plan.resetEvents.map((ev) =>
      env.DB.prepare("INSERT INTO checklist_events (date, item_id, checked, ts, source) VALUES (?, ?, 0, ?, 'reset')").bind(ev.date, ev.itemId, ev.ts),
    ),
    logStmt(env, p.ts, person, 'strafe', `${cat.logText}, ${plan.text}`, p.minutes),
  ];
  await env.DB.batch(stmts);
  return plan.text;
}

// ---------- Bewertung des Morgens ----------

function ratingCat(score: number, minutes: number): CatalogEntry {
  return { id: 0, label: `Morgendliches Benehmen: ${score}/10`, logText: `Morgendliches Benehmen: ${score}/10`, minutes, special: null, hint: null, sort: 0 };
}

export function planRating(l: Loaded, scoreIn: unknown, mode: 'A' | 'B', person: string) {
  const e = l.engine;
  const score = Number(scoreIn);
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new UserError('Bitte eine Bewertung von 1 bis 10 wählen.');
  const existing = e.ratingOf(e.today);
  if (existing) throw new UserError(`Heute schon bewertet: ${existing.score}/10 von ${existing.person}.`);
  const rating: Rating = { date: e.today, ts: e.now, score, person };
  const ratings = [...(l.input.ratings ?? []), rating];
  const minutes = ratingPenaltyMinutes(l.settings, score);
  if (minutes > 0) {
    const plan = planPenalty(l, ratingCat(score, minutes), mode, person, { ratings });
    return { score, minutes, penalty: plan.penalty, text: `${fmtMinutes(minutes)} Abzug – ${plan.text}` };
  }
  const after = new Engine({ ...l.input, ratings });
  const st = after.status();
  let text: string;
  if (st.allowed) text = 'kein Abzug – Medienzeit kann beginnen';
  else if (!after.checklistDoneNow()) text = 'kein Abzug – Medienzeit beginnt, sobald die Checkliste erledigt ist';
  else {
    const next = after.nextAllowed('hopeful', e.now);
    text = next ? `kein Abzug – Medien ab ${uhr(fmtWhen(next, e.now))}` : 'kein Abzug';
  }
  return { score, minutes: 0, penalty: null as Penalty | null, text };
}

export async function rateMorning(env: Env, l: Loaded, person: string, body: { score: number; mode: string }) {
  const mode = body.mode === 'B' ? 'B' : 'A';
  const r = planRating(l, body.score, mode, person);
  const e = l.engine;
  const stmts: D1PreparedStatement[] = [];
  if (r.penalty) {
    const p = r.penalty;
    stmts.push(
      env.DB.prepare(
        'INSERT INTO penalties (ts, person, catalog_id, label, minutes, mode, date, cut, carry) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
      ).bind(p.ts, p.person, p.label, p.minutes, p.mode, p.date, p.cut, p.carry),
    );
  }
  stmts.push(
    env.DB.prepare('INSERT INTO ratings (date, ts, person, score, minutes, mode) VALUES (?, ?, ?, ?, ?, ?)').bind(e.today, e.now, person, r.score, r.minutes, r.penalty ? mode : null),
  );
  const text = `Morgendliches Benehmen bewertet: ${r.score}/10 – ${r.text}`;
  stmts.push(logStmt(env, e.now, person, 'bewertung', text, r.minutes || null));
  try {
    await env.DB.batch(stmts);
  } catch {
    throw new UserError('Heute wurde schon bewertet.');
  }
  return text;
}

// ---------- PIN ----------

export async function verifyPin(env: Env, pins: Map<string, string>, person: string, pin: string, now: number) {
  const expected = pins.get(person);
  if (!expected) throw new UserError('Unbekannte Person.');
  const row = await env.DB.prepare('SELECT fails, locked_until FROM pin_attempts WHERE person = ?').bind(person).first<{ fails: number; locked_until: number }>();
  if (row && row.locked_until > now) {
    throw new UserError(`Zu viele falsche Versuche. Gesperrt bis ${hm(row.locked_until)} Uhr.`);
  }
  if (String(pin ?? '').trim() === expected) {
    if (row && row.fails) await env.DB.prepare('UPDATE pin_attempts SET fails = 0, locked_until = 0 WHERE person = ?').bind(person).run();
    return;
  }
  const fails = (row?.fails ?? 0) + 1;
  const locked = fails >= 5 ? now + 15 * 60_000 : 0;
  await env.DB.prepare(
    'INSERT INTO pin_attempts (person, fails, locked_until) VALUES (?, ?, ?) ON CONFLICT(person) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until',
  )
    .bind(person, locked ? 0 : fails, locked)
    .run();
  if (locked) {
    await addLog(env, now, person, 'einstellung', `5× falsche PIN – ${person} für 15 Min. gesperrt`);
    throw new UserError('PIN falsch. Zu viele Versuche – 15 Minuten gesperrt.');
  }
  throw new UserError(`PIN falsch (noch ${5 - fails} ${5 - fails === 1 ? "Versuch" : "Versuche"}).`);
}

// ---------- Änderungen mit PIN ----------

export async function reducePenalty(env: Env, l: Loaded, person: string, body: { penaltyId: number; minutes: number | null; reason: string }) {
  const e = l.engine;
  const p = l.input.penalties.find((x) => x.id === Number(body.penaltyId));
  if (!p) throw new UserError('Diese Strafe ist schon abgegolten.');
  const reason = need(body.reason, 'Bitte eine Begründung angeben.');
  const minutes = body.minutes === null || body.minutes === undefined ? null : posInt(body.minutes, 'Minuten');
  const split = e.reductionSplit(p, minutes);
  if (split.queueMinutes + split.cutMinutes === 0) throw new UserError('Da ist nichts mehr zu verringern.');
  const after = new Engine({
    ...l.input,
    adjustments: [...l.input.adjustments, { id: -1, ts: e.now, penaltyId: p.id, ...split }],
  });
  const total = split.queueMinutes + split.cutMinutes;
  const what = minutes === null ? `Strafe „${p.label}“ aufgehoben` : `Strafe „${p.label}“ um ${total} Min. verringert`;
  const text = `${reason}, ${what} – jetzt: ${after.status().text}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO adjustments (ts, penalty_id, queue_minutes, cut_minutes, person, reason) VALUES (?, ?, ?, ?, ?, ?)').bind(
      e.now,
      p.id,
      split.queueMinutes,
      split.cutMinutes,
      person,
      reason,
    ),
    logStmt(env, e.now, person, 'aenderung', text, -total),
  ]);
  return text;
}

export async function changeDay(env: Env, l: Loaded, person: string, body: { date: string; start?: string; end?: string; reason: string }) {
  const e = l.engine;
  const reason = need(body.reason, 'Bitte eine Begründung angeben.');
  const date = String(body.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < e.today || date > addDays(e.today, 365)) throw new UserError('Bitte ein Datum ab heute wählen.');
  const start = body.start ? hmToMin(body.start) : null;
  const end = body.end ? hmToMin(body.end) : null;
  if (body.start && start === null) throw new UserError('Startzeit ungültig (z. B. 10:30).');
  if (body.end && end === null) throw new UserError('Endzeit ungültig (z. B. 22:15).');
  if (start === null && end === null) throw new UserError('Bitte Start- oder Endzeit angeben.');
  const before = e.dayInfo(date);
  const changes = [
    ...(start !== null ? [{ id: -1, ts: e.now, date, kind: 'start' as const, minutes: start }] : []),
    ...(end !== null ? [{ id: -2, ts: e.now, date, kind: 'end' as const, minutes: end }] : []),
  ];
  const after = new Engine({ ...l.input, dayChanges: [...l.input.dayChanges, ...changes] }).dayInfo(date);
  const parts: string[] = [];
  if (start !== null) parts.push(after.start < before.start ? `darf am ${dateLabel(date)} schon ab ${minToHm(after.start)} Uhr` : `Medien am ${dateLabel(date)} erst ab ${minToHm(after.start)} Uhr`);
  if (end !== null) parts.push(after.end >= before.end ? `darf am ${dateLabel(date)} bis ${minToHm(after.end)} Uhr` : `Medienzeit endet am ${dateLabel(date)} schon um ${minToHm(after.end)} Uhr`);
  const text = `${reason}, ${parts.join(', ')}`;
  await env.DB.batch([
    ...changes.map((c) =>
      env.DB.prepare('INSERT INTO day_changes (ts, date, kind, minutes, person, reason) VALUES (?, ?, ?, ?, ?, ?)').bind(c.ts, c.date, c.kind, c.minutes, person, reason),
    ),
    logStmt(env, e.now, person, 'aenderung', text),
  ]);
  return text;
}

export async function addGrant(env: Env, l: Loaded, person: string, body: { minutes: number; reason: string }) {
  const e = l.engine;
  const reason = need(body.reason, 'Bitte eine Begründung angeben.');
  const minutes = posInt(body.minutes, 'Minuten');
  if (minutes > 720) throw new UserError('Höchstens 12 Stunden am Stück.');
  const to = e.now + minutes * 60_000;
  const text = `${reason}, Sonderfreigabe für ${fmtMinutes(minutes)} bis ${uhr(fmtWhen(to, e.now))}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO grants (ts, from_ts, to_ts, person, reason) VALUES (?, ?, ?, ?, ?)').bind(e.now, e.now, to, person, reason),
    logStmt(env, e.now, person, 'aenderung', text, minutes),
  ]);
  return text;
}

const CONDITIONS: ItemCondition[] = ['always', 'school', 'study', 'tomorrowSchool'];

export async function saveSettings(env: Env, l: Loaded, person: string, body: Record<string, unknown>) {
  const now = l.engine.now;
  const stmts: D1PreparedStatement[] = [];
  const changed: string[] = [];

  if (body.settings) {
    const s = body.settings as Settings;
    const t = (v: unknown, name: string) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0 || x > 1440) throw new UserError(`${name}: ungültige Uhrzeit.`);
      return x;
    };
    const num = (v: unknown, name: string, max: number) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 1 || x > max) throw new UserError(`${name}: bitte eine Zahl zwischen 1 und ${max}.`);
      return x;
    };
    const num0 = (v: unknown, name: string) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0 || x > 1440) throw new UserError(`${name}: bitte eine Zahl zwischen 0 und 1440.`);
      return x;
    };
    const clean: Settings = {
      earliestStart: Object.fromEntries(['1', '2', '3', '4', '5'].map((k) => [k, t(s.earliestStart?.[k], 'Früheste Startzeit')])),
      freeDayStart: t(s.freeDayStart, 'Start an freien Tagen'),
      endBeforeSchool: t(s.endBeforeSchool, 'Ende vor Schultagen'),
      endOtherwise: t(s.endOtherwise, 'Ende sonst'),
      pauseActiveMinutes: num(s.pauseActiveMinutes, 'Pausenregel (aktiv)', 1440),
      pauseBreakMinutes: num(s.pauseBreakMinutes, 'Pausenregel (Pause zählt ab)', 600),
      pauseMinutes: num(s.pauseMinutes, 'Pausendauer', 600),
      offlineMinutes: num(s.offlineMinutes, 'Offline-Dauer', 2880),
      warnMinutes: num(s.warnMinutes, 'Vorwarnung', 60),
      examDays: num(s.examDays, 'Lerntage vor Klausur', 30),
      testDays: num(s.testDays, 'Lerntage vor Test', 30),
      ratingRequired: !!s.ratingRequired,
      ratingFrom: l.settings.ratingFrom,
      ratingMinutes: {
        ok: num0(s.ratingMinutes?.ok, 'Abzug bei 6–7 Punkten'),
        bad: num0(s.ratingMinutes?.bad, 'Abzug bei 3–5 Punkten'),
        worst: num0(s.ratingMinutes?.worst, 'Abzug bei 1–2 Punkten'),
      },
    };
    stmts.push(
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('main', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(clean)),
    );
    changed.push('Zeiten und Regeln');
  }

  if (Array.isArray(body.holidays)) {
    stmts.push(env.DB.prepare('DELETE FROM holidays'));
    for (const h of body.holidays as { from: string; to: string; label: string }[]) {
      const ok = /^\d{4}-\d{2}-\d{2}$/;
      if (!ok.test(h.from) || !ok.test(h.to) || h.to < h.from) throw new UserError(`Ferien „${h.label}“: Datum prüfen.`);
      stmts.push(env.DB.prepare('INSERT INTO holidays (date_from, date_to, label) VALUES (?, ?, ?)').bind(h.from, h.to, need(h.label, 'Ferien brauchen einen Namen.')));
    }
    changed.push('Ferien und Feiertage');
  }

  if (Array.isArray(body.items)) {
    const list = body.items as { id?: number; label: string; condition: ItemCondition }[];
    const keep = new Set(list.filter((i) => i.id).map((i) => Number(i.id)));
    for (const old of l.allItems) if (old.active && !keep.has(old.id)) stmts.push(env.DB.prepare('UPDATE checklist_items SET active = 0 WHERE id = ?').bind(old.id));
    list.forEach((it, idx) => {
      const label = need(it.label, 'Checklisten-Punkt ohne Text.');
      const cond = CONDITIONS.includes(it.condition) ? it.condition : 'always';
      if (it.id) stmts.push(env.DB.prepare('UPDATE checklist_items SET label = ?, condition = ?, sort = ?, active = 1 WHERE id = ?').bind(label, cond, idx + 1, Number(it.id)));
      else stmts.push(env.DB.prepare('INSERT INTO checklist_items (label, condition, sort) VALUES (?, ?, ?)').bind(label, cond, idx + 1));
    });
    changed.push('Checkliste');
  }

  if (Array.isArray(body.catalog)) {
    const list = body.catalog as { id?: number; label: string; logText: string; minutes: number; special?: string | null; hint?: string | null }[];
    const keep = new Set(list.filter((c) => c.id).map((c) => Number(c.id)));
    for (const old of l.catalog) if (!keep.has(old.id)) stmts.push(env.DB.prepare('UPDATE catalog SET active = 0 WHERE id = ?').bind(old.id));
    list.forEach((c, idx) => {
      const label = need(c.label, 'Verstoß ohne Text.');
      const logText = (c.logText ?? '').trim() || label;
      const minutes = posInt(c.minutes, `Minuten bei „${label}“`);
      const special = c.special === 'reset_checklist' ? 'reset_checklist' : null;
      const hint = (c.hint ?? '').trim() || null;
      if (c.id)
        stmts.push(
          env.DB.prepare('UPDATE catalog SET label = ?, log_text = ?, minutes = ?, special = ?, hint = ?, sort = ?, active = 1 WHERE id = ?').bind(
            label,
            logText,
            minutes,
            special,
            hint,
            idx + 1,
            Number(c.id),
          ),
        );
      else
        stmts.push(
          env.DB.prepare('INSERT INTO catalog (label, log_text, minutes, special, hint, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(label, logText, minutes, special, hint, idx + 1),
        );
    });
    changed.push('Strafenkatalog');
  }

  if (!stmts.length) throw new UserError('Nichts geändert.');
  const text = `Einstellungen geändert: ${changed.join(', ')}`;
  stmts.push(logStmt(env, now, person, 'einstellung', text));
  await env.DB.batch(stmts);
  return text;
}

// ---------- ohne PIN ----------

export async function addExam(env: Env, l: Loaded, person: string, body: { date: string; kind: string; subject: string }) {
  const date = String(body.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < l.engine.today) throw new UserError('Bitte ein Datum ab heute wählen.');
  const kind = body.kind === 'test' ? 'test' : 'klausur';
  const subject = need(body.subject, 'Bitte das Fach angeben.');
  const text = `${kind === 'test' ? 'Test' : 'Klausur'} ${subject} am ${dateLabel(date)} eingetragen`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO exams (date, kind, subject, person, ts) VALUES (?, ?, ?, ?, ?)').bind(date, kind, subject, person, l.engine.now),
    logStmt(env, l.engine.now, person, 'klausur', text),
  ]);
  return text;
}

export async function deleteExam(env: Env, l: Loaded, person: string, body: { id: number }) {
  const ex = l.exams.find((x) => x.id === Number(body.id));
  if (!ex) throw new UserError('Eintrag nicht gefunden.');
  const text = `${ex.kind === 'test' ? 'Test' : 'Klausur'} ${ex.subject} am ${dateLabel(ex.date)} gelöscht`;
  await env.DB.batch([env.DB.prepare('DELETE FROM exams WHERE id = ?').bind(ex.id), logStmt(env, l.engine.now, person, 'klausur', text)]);
  return text;
}

/** Checkliste abhaken – von Ludwig (person = null) oder von einem Erwachsenen (ohne PIN). */
export async function checkItem(env: Env, l: Loaded, body: { itemId: number; checked: boolean }, person: string | null = null) {
  const e = l.engine;
  const item = e.applicableItems(e.today).find((i) => i.id === Number(body.itemId));
  if (!item) throw new UserError('Diesen Punkt gibt es heute nicht.');
  const wasDone = e.checklistDoneNow();
  const checked = !!body.checked;
  const ev: ChecklistEvent = { date: e.today, itemId: item.id, checked, ts: e.now };
  const after = new Engine({ ...l.input, checklistEvents: [...l.input.checklistEvents, ev] });
  const isDone = after.checklistDoneNow();
  const who = person ?? 'Ludwig';
  const source = person ? `eltern:${person}` : 'ludwig';
  const stmts = [
    env.DB.prepare('INSERT INTO checklist_events (date, item_id, checked, ts, source) VALUES (?, ?, ?, ?, ?)').bind(e.today, item.id, checked ? 1 : 0, e.now, source),
  ];
  if (person) {
    // Erwachsene: jede Änderung protokollieren
    const what = checked ? `Checkliste: „${item.label}“ abgehakt` : `Checkliste: „${item.label}“ wieder offen`;
    const extra = !wasDone && isDone ? ' – Checkliste erledigt' : wasDone && !isDone ? ' – Checkliste wieder offen' : '';
    stmts.push(logStmt(env, e.now, who, 'checkliste', what + extra));
  } else {
    if (!wasDone && isDone) stmts.push(logStmt(env, e.now, who, 'checkliste', 'Checkliste erledigt'));
    if (wasDone && !isDone) stmts.push(logStmt(env, e.now, who, 'checkliste', `Checkliste wieder offen („${item.label}“ abgewählt)`));
  }
  await env.DB.batch(stmts);
}

// ---------- Helfer ----------

function need(v: unknown, msg: string): string {
  const s = String(v ?? '').trim();
  if (!s) throw new UserError(msg);
  return s.slice(0, 300);
}

function posInt(v: unknown, name: string): number {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0 || x > 100000) throw new UserError(`${name}: bitte eine ganze Zahl größer als 0.`);
  return x;
}
