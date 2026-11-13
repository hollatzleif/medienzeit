// Gemeinsame Helfer für beide Ansichten.
'use strict';

const TZ = 'Europe/Zurich';
let serverOffset = 0; // Serverzeit − Gerätezeit

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowMs = () => Date.now() + serverOffset;

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(`api/${path}`, opts);
  } catch {
    throw new Error('Keine Verbindung – bitte nochmal versuchen.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Fehler ${res.status}`);
  if (data.serverTime) serverOffset = data.serverTime - Date.now();
  if (data.state && data.state.serverTime) serverOffset = data.state.serverTime - Date.now();
  return data;
}

const fmtParts = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const hm = (ts) => fmtParts.format(new Date(ts));
const dayLabel = (ts) => fmtDay.format(new Date(ts));
const isoDate = (ts) => fmtIso.format(new Date(ts));

function when(ts) {
  const today = isoDate(nowMs());
  const d = isoDate(ts);
  if (d === today) return hm(ts);
  const tomorrow = isoDate(nowMs() + 86400000);
  if (d === tomorrow) return `morgen ${hm(ts)}`;
  return `${dayLabel(ts)} ${hm(ts)}`;
}

function fmtMin(min) {
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} Std. ${r} Min.` : `${h} Std.`;
}

function countdown(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (h >= 24) return `${Math.floor(h / 24)} T. ${h % 24} Std.`;
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// ---------- Bausteine ----------

let statusTarget = null;
let statusKind = null;

function renderStatus(el, state) {
  const st = state.status;
  statusTarget = st.until;
  statusKind = st.kind;
  el.className = `card status k-${st.kind}`;
  const sub = [];
  if (st.kind === 'allowed' && state.pause && state.pause.nextPauseAt && state.pause.nextPauseAt < (st.until || Infinity) + 1) {
    sub.push(`Pause ab ${hm(state.pause.nextPauseAt)}`);
  }
  if (state.pause && state.pause.active && state.pause.activeSoFarMinutes > 0) sub.push(`am Laptop seit ${fmtMin(state.pause.activeSoFarMinutes)} ohne Pause`);
  const b = st.budget;
  if (b && b.limitMinutes !== null) {
    sub.push(`Laptop heute: ${fmtMin(b.usedMinutes)} von ${fmtMin(b.limitMinutes)} genutzt${b.deductedMinutes ? `, ${fmtMin(b.deductedMinutes)} Abzug` : ''} · noch ${fmtMin(b.leftMinutes)}`);
  }
  el.innerHTML = `
    <div class="big">${esc(st.text)}</div>
    <div class="count" id="countdown"></div>
    <div class="sub">${esc(sub.join(' · '))}</div>`;
  tickCountdown();
}

function tickCountdown() {
  const el = document.getElementById('countdown');
  if (!el) return;
  if (!statusTarget) { el.textContent = ''; return; }
  const left = statusTarget - nowMs();
  const label = statusKind === 'allowed' || statusKind === 'grant' ? 'noch ' : statusKind === 'pause' ? 'noch ' : 'in ';
  el.textContent = left > 0 ? label + countdown(left) : '…';
  if (left <= 0 && typeof window.refresh === 'function' && !tickCountdown.pending) {
    tickCountdown.pending = true;
    setTimeout(() => { tickCountdown.pending = false; window.refresh(); }, 1500);
  }
}
setInterval(tickCountdown, 1000);

function renderPenalties(state, withActions) {
  if (!state.penalties.length) return '<p class="muted">Keine offenen Strafen. 👍</p>';
  return `<ul class="list">${state.penalties.map((p) => `
    <li>
      <div class="pen-row">
        <div>
          <div class="title">${esc(p.label)}</div>
          <div class="muted small">${esc(p.person)}, ${esc(dayLabel(p.ts))} ${hm(p.ts)} · ${p.mode === 'B' ? 'Rest von „früher Schluss“' : p.mode === 'C' ? `${fmtMin(p.minutes)} vom Tageskonto` : fmtMin(p.minutes)}</div>
          <div class="small">${p.mode === 'C' ? 'wird noch abgezogen:' : 'noch'} <b>${fmtMin(p.remainingMinutes)}</b>${p.waitingUntil ? ` · beginnt ${esc(when(p.waitingUntil))}` : ''}${p.endsAt ? ` · voraussichtlich abgegolten ${esc(when(p.endsAt))}` : ''}</div>
        </div>
        ${withActions ? `<button class="ghost" data-reduce="${p.id}">Verringern</button>` : ''}
      </div>
    </li>`).join('')}</ul>`;
}

function renderWeek(state) {
  const today = isoDate(nowMs());
  return `<table class="week">${state.days.map((d) => `
    <tr class="${d.date === today ? 'today' : ''}">
      <td>${esc(d.label)}</td>
      <td>${d.school ? 'Schule' : esc(d.holiday || 'frei')}</td>
      <td style="text-align:right">${esc(d.start)}–${esc(d.end)}${d.budget ? `<br><span class="muted small">max. ${fmtMin(d.budget)}</span>` : ''}</td>
    </tr>`).join('')}</table>
    <p class="muted small">Medien jeweils erst, wenn die Checkliste erledigt ist. „max.“ = höchstens so viel Zeit am Laptop an dem Tag.</p>`;
}

function renderExams(state, withDelete) {
  if (!state.exams.length) return '<p class="muted">Keine Klausuren oder Tests eingetragen.</p>';
  return `<ul class="list">${state.exams.map((x) => `
    <li class="pen-row">
      <div>
        <div class="title">${esc(x.kindLabel)} ${esc(x.subject)} – ${esc(x.dateLabel)}</div>
        <div class="muted small">${x.studyFrom ? `Lernstunde ${x.studyFrom === x.studyTo ? `am ${esc(x.studyFrom)}` : `von ${esc(x.studyFrom)} bis ${esc(x.studyTo)}`}` : 'keine Lerntage mehr'}</div>
      </div>
      ${withDelete ? `<button class="ghost" data-exam-del="${x.id}">Löschen</button>` : ''}
    </li>`).join('')}</ul>`;
}

function renderLog(entries) {
  if (!entries.length) return '<p class="muted">Noch keine Einträge.</p>';
  return `<ul class="list">${entries.map((e) => `
    <li>
      <div>${esc(e.text)}</div>
      <div class="muted small">${e.person ? `${esc(e.person)}, ` : ''}${fmtDate.format(new Date(e.ts))}, ${hm(e.ts)}</div>
    </li>`).join('')}</ul>`;
}

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = `toast${isErr ? ' err' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5000 : 3500);
}

function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return { el: bg.firstElementChild, close: () => bg.remove() };
}

/** Regelmäßig neu laden, solange die Seite sichtbar ist. */
function startPolling(fn, ms) {
  let timer = null;
  const run = () => { if (document.visibilityState === 'visible') fn(); };
  const start = () => { clearInterval(timer); timer = setInterval(run, ms); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { fn(); start(); } else clearInterval(timer); });
  start();
}
