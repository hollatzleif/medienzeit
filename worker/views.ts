// Zustand für die beiden Ansichten zusammenstellen.

import { parsePins, type Env, type Loaded } from './db';
import { addDays, dateLabel, localDate, minToHm } from './engine/time';

type Row = Record<string, unknown>;

export async function recentLog(env: Env, since: number, limit = 300) {
  const r = await env.DB.prepare('SELECT ts, person, kind, text, minutes FROM log WHERE ts >= ? ORDER BY ts DESC LIMIT ?').bind(since, limit).all();
  return (r.results as Row[]).map((x) => ({
    ts: Number(x.ts),
    person: x.person ? String(x.person) : null,
    kind: String(x.kind),
    text: String(x.text),
    minutes: x.minutes === null ? null : Number(x.minutes),
  }));
}

export function examView(l: Loaded) {
  const today = l.engine.today;
  return l.exams
    .filter((e) => e.date >= today)
    .map((e) => {
      const lim = e.kind === 'klausur' ? l.settings.examDays : l.settings.testDays;
      let first = addDays(e.date, -lim);
      if (first < today) first = today;
      const last = addDays(e.date, -1);
      return {
        id: e.id,
        date: e.date,
        dateLabel: dateLabel(e.date),
        kind: e.kind,
        kindLabel: e.kind === 'klausur' ? 'Klausur' : 'Test',
        subject: e.subject,
        studyFrom: first <= last ? dateLabel(first) : null,
        studyTo: first <= last ? dateLabel(last) : null,
      };
    });
}

export function baseState(l: Loaded) {
  const e = l.engine;
  const status = e.status();
  return {
    serverTime: e.now,
    status,
    penalties: e.openPenalties(),
    checklist: e.checklistView(),
    pause: e.pauseView(),
    days: e.upcomingDays(7).map((d) => ({
      date: d.date,
      label: dateLabel(d.date),
      school: d.school,
      holiday: d.holiday,
      start: minToHm(d.start),
      end: minToHm(d.end),
      checklistFirst: e.applicableItems(d.date).length > 0,
    })),
    exams: examView(l),
    timeline: e
      .timeline('real', e.now, e.now + 36 * 3_600_000, 'hopeful')
      .slice(0, 12)
      .map((s) => ({ from: s.from, to: s.to, kind: s.kind, text: s.text })),
    device: l.device
      ? {
          lastPoll: l.device.lastPoll,
          session: l.device.session,
          online: e.now - l.device.lastPoll < 90_000,
        }
      : null,
  };
}

export async function ludwigState(env: Env, l: Loaded) {
  return {
    ...baseState(l),
    log: await recentLog(env, l.engine.now - 7 * 86_400_000, 200),
  };
}

export async function parentState(env: Env, l: Loaded) {
  return {
    ...baseState(l),
    persons: [...parsePins(env.PINS).keys()],
    catalog: l.catalog,
    settings: l.settings,
    holidays: l.holidays.filter((h) => h.to >= addDays(localDate(l.engine.now), -60)),
    items: l.allItems.filter((i) => i.active),
    log: await recentLog(env, l.engine.now - 14 * 86_400_000, 300),
  };
}
