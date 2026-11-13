// Schnittstelle für das Sperrprogramm auf dem Laptop (siehe docs/geraete-api.md).

import { load, logStmt, maybeCheckpoint, type Env } from './db';
import { dmy, hm, localDate } from './engine/time';

interface PollBody {
  agentVersion?: string;
  session?: 'none' | 'active' | 'locked';
  activity?: { from: number; to: number }[];
  events?: { ts: number; type: string; from?: number; to?: number; text?: string }[];
}

const fmtRange = (from: number, to: number) =>
  localDate(from) === localDate(to) ? `${dmy(from)} ${hm(from)}–${hm(to)}` : `${dmy(from)} ${hm(from)} bis ${dmy(to)} ${hm(to)}`;

export async function devicePoll(env: Env, body: PollBody, now: number) {
  const session = body.session === 'active' || body.session === 'locked' ? body.session : 'none';
  const stmts: D1PreparedStatement[] = [];

  // 1. Aktivität festhalten (für die Pausenregel)
  if (session === 'active') {
    const last = await env.DB.prepare('SELECT id, to_ts FROM activity ORDER BY to_ts DESC LIMIT 1').first<{ id: number; to_ts: number }>();
    if (last && last.to_ts >= now - 60_000 && last.to_ts <= now) stmts.push(env.DB.prepare('UPDATE activity SET to_ts = ? WHERE id = ?').bind(now, last.id));
    else stmts.push(env.DB.prepare('INSERT INTO activity (from_ts, to_ts) VALUES (?, ?)').bind(now, now));
  }
  for (const a of (body.activity ?? []).slice(0, 500)) {
    const from = Number(a.from);
    const to = Math.min(Number(a.to), now);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from && now - from < 7 * 86_400_000) {
      stmts.push(env.DB.prepare('INSERT INTO activity (from_ts, to_ts) VALUES (?, ?)').bind(from, to));
    }
  }

  // 2. Ereignisse ins Protokoll
  for (const ev of (body.events ?? []).slice(0, 100)) {
    const ts = Number.isFinite(Number(ev.ts)) ? Math.min(Number(ev.ts), now) : now;
    const text = String(ev.text ?? '').slice(0, 300);
    switch (ev.type) {
      case 'started':
        stmts.push(logStmt(env, ts, 'Laptop', 'laptop', 'Sperrprogramm gestartet'));
        break;
      case 'offline':
        if (ev.from && ev.to && ev.to > ev.from) {
          const mins = Math.round((Number(ev.to) - Number(ev.from)) / 60_000);
          stmts.push(logStmt(env, ts, 'Laptop', 'laptop', `Laptop lief ohne Verbindung: ${fmtRange(Number(ev.from), Number(ev.to))} (${mins} Min.)`, mins));
        }
        break;
      case 'logoff':
        stmts.push(logStmt(env, ts, 'Laptop', 'laptop', `Ludwig abgemeldet${text ? `: ${text}` : ''}`));
        break;
      case 'error':
        stmts.push(logStmt(env, ts, 'Laptop', 'laptop', `Fehler im Sperrprogramm: ${text}`));
        break;
      default:
        break; // Vorwarnungen werden nicht protokolliert
    }
  }

  stmts.push(
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('device', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(
      JSON.stringify({ lastPoll: now, session, agentVersion: String(body.agentVersion ?? '').slice(0, 20) }),
    ),
  );
  await env.DB.batch(stmts);

  // 3. Zustand berechnen
  const l = await load(env, now);
  await maybeCheckpoint(env, l);
  const e = l.engine;
  const st = e.status();
  const pv = e.pauseView();
  return {
    serverTime: now,
    allowed: st.allowed,
    text: st.text,
    kind: st.kind,
    lockId: st.lockId,
    segments: e.plan().map((s) => ({ from: s.from, to: s.to, allowed: s.allowed, kind: s.kind, text: s.text, lockId: s.lockId })),
    offlineMinutes: l.settings.offlineMinutes,
    warnMinutes: l.settings.warnMinutes,
    penaltyGraceSeconds: 60,
    reloginGraceSeconds: 15,
    budget: { leftMinutes: e.budgetView().leftMinutes },
    pause: {
      activeMinutes: l.settings.pauseActiveMinutes,
      breakMinutes: l.settings.pauseBreakMinutes,
      pauseMinutes: l.settings.pauseMinutes,
      activeSoFarMinutes: pv.activeSoFarMinutes,
    },
  };
}
