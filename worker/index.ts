// Einstieg des Cloudflare Workers: Routen, geheime Links, statische Dateien.

import {
  UserError,
  addExam,
  addGrant,
  changeDay,
  createPenalty,
  deleteExam,
  checkItem,
  planPenalty,
  reducePenalty,
  saveSettings,
  verifyPin,
} from './actions';
import { load, maybeCheckpoint, parsePins, type Env } from './db';
import { devicePoll } from './device';
import { addDays, dayStart } from './engine/time';
import { ludwigState, parentState } from './views';

const STATIC = new Set(['app.css', 'common.js', 'ludwig.js', 'eltern.js', 'icon.svg', 'manifest-l.json', 'manifest-e.json']);

const SEC_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const notFound = () => new Response('', { status: 404, headers: SEC_HEADERS });

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS } });

function safeEqual(a: string, b: string | undefined): boolean {
  if (!b || b.length < 16 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function serveAsset(env: Env, req: Request, file: string): Promise<Response> {
  const res = await env.ASSETS.fetch(new Request(new URL(`/${file}`, req.url), { method: 'GET' }));
  if (!res.ok) return notFound();
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) headers.set(k, v);
  headers.set('Cache-Control', file.endsWith('.html') ? 'no-store' : 'public, max-age=300');
  return new Response(res.body, { status: 200, headers });
}

async function readBody(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, any>) : {};
  } catch {
    return {};
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (err) {
      if (err instanceof UserError) return json({ ok: false, error: err.message }, 400);
      console.error(err);
      return json({ ok: false, error: 'Interner Fehler – bitte später nochmal versuchen.' }, 500);
    }
  },
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const now = Date.now();

  // Laptop
  if (url.pathname === '/api/device/poll' && req.method === 'POST') {
    const auth = req.headers.get('Authorization') ?? '';
    if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), env.DEVICE_TOKEN)) return notFound();
    return json(await devicePoll(env, (await readBody(req)) as never, now));
  }

  const [area, token, ...rest] = parts;
  if ((area !== 'l' && area !== 'e') || !token) return notFound();
  const isParent = area === 'e';
  if (!safeEqual(token, isParent ? env.PARENT_TOKEN : env.LUDWIG_TOKEN)) return notFound();

  // Seite und statische Dateien
  if (rest.length === 0) {
    if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${url.pathname}/`, 302);
    return serveAsset(env, req, isParent ? 'eltern.html' : 'ludwig.html');
  }
  if (rest.length === 1 && STATIC.has(rest[0]) && req.method === 'GET') return serveAsset(env, req, rest[0]);
  if (rest[0] !== 'api' || rest.length !== 2) return notFound();
  const action = rest[1];

  const l = await load(env, now);
  await maybeCheckpoint(env, l);

  // ---------- Ludwig ----------
  if (!isParent) {
    if (action === 'state' && req.method === 'GET') return json(await ludwigState(env, l));
    if (action === 'check' && req.method === 'POST') {
      await checkItem(env, l, (await readBody(req)) as never);
      return json({ ok: true, state: await ludwigState(env, await load(env, now)) });
    }
    return notFound();
  }

  // ---------- Eltern ----------
  if (action === 'state' && req.method === 'GET') return json(await parentState(env, l));

  if (action === 'log' && req.method === 'GET') return json(await queryLog(env, url));

  if (req.method !== 'POST') return notFound();
  const body = await readBody(req);
  const pins = parsePins(env.PINS);
  const person = String(body.person ?? '');
  if (!pins.has(person)) throw new UserError('Bitte zuerst oben deinen Namen wählen.');

  const done = async (message: string) => json({ ok: true, message, state: await parentState(env, await load(env, now)) });

  switch (action) {
    case 'preview':
    case 'penalty': {
      const cat = l.catalog.find((c) => c.id === Number(body.catalogId));
      if (!cat) throw new UserError('Diesen Verstoß gibt es nicht mehr.');
      const mode = body.mode === 'B' ? 'B' : 'A';
      if (action === 'preview') return json({ ok: true, text: planPenalty(l, cat, mode, person).text });
      return done(await createPenalty(env, l, cat, mode, person));
    }
    case 'check':
      await checkItem(env, l, body as never, person);
      return done('Checkliste aktualisiert');
    case 'exam':
      return done(await addExam(env, l, person, body as never));
    case 'exam-delete':
      return done(await deleteExam(env, l, person, body as never));
  }

  // Ab hier nur mit PIN
  await verifyPin(env, pins, person, String(body.pin ?? ''), now);
  switch (action) {
    case 'verify':
      return json({ ok: true });
    case 'reduce':
      return done(await reducePenalty(env, l, person, body as never));
    case 'day':
      return done(await changeDay(env, l, person, body as never));
    case 'grant':
      return done(await addGrant(env, l, person, body as never));
    case 'settings':
      return done(await saveSettings(env, l, person, body));
  }
  return notFound();
}

async function queryLog(env: Env, url: URL) {
  const where: string[] = [];
  const args: unknown[] = [];
  const person = url.searchParams.get('person');
  const kind = url.searchParams.get('kind');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (person) {
    where.push('person = ?');
    args.push(person);
  }
  if (kind) {
    where.push('kind = ?');
    args.push(kind);
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.push('ts >= ?');
    args.push(dayStart(from));
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push('ts < ?');
    args.push(dayStart(addDays(to, 1)));
  }
  const sql = `SELECT ts, person, kind, text, minutes FROM log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC LIMIT 500`;
  const r = await env.DB.prepare(sql).bind(...args).all();
  return { ok: true, log: r.results };
}
