'use strict';

let state = null;
let mode = 'A';
let me = localStorage.getItem('medienzeit-person') || '';
let pinCache = { person: '', pin: '', until: 0 };
let currentTab = 'overview';
let settingsDirty = false;

const WD = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const COND = { always: 'jeden Tag', school: 'nur an Schultagen', study: 'nur bei Klausur/Test', tomorrowSchool: 'nur wenn morgen Schule ist' };
const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMin = (s) => { const [h, m] = String(s || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN; };

// ---------- Person ----------

function renderWho() {
  $('#who').textContent = me ? `${me} ▾` : 'Wer bist du?';
}

function choosePerson(force) {
  if (!state) return;
  if (!force && me && state.persons.includes(me)) return;
  const m = modal(`<h2>Wer bist du?</h2><p class="muted small">Wird auf diesem Handy gemerkt.</p>
    <div class="chips">${state.persons.map((p) => `<button class="chip ${p === me ? 'on' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>`);
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    me = b.dataset.p;
    localStorage.setItem('medienzeit-person', me);
    renderWho();
    m.close();
  });
}
$('#who').addEventListener('click', () => choosePerson(true));

function needPerson() {
  if (me && state && state.persons.includes(me)) return true;
  choosePerson(true);
  return false;
}

function askPin(title) {
  if (pinCache.person === me && pinCache.until > Date.now()) return Promise.resolve(pinCache.pin);
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted small">PIN von ${esc(me)}</p>
      <input class="pin-input" type="password" inputmode="numeric" autocomplete="off" id="pin-in">
      <p></p><div class="row"><button class="secondary" id="pin-no">Abbrechen</button><button id="pin-ok">OK</button></div>`);
    const input = $('#pin-in', m.el);
    setTimeout(() => input.focus(), 50);
    const ok = () => { const pin = input.value.trim(); if (!pin) return; m.close(); resolve(pin); };
    $('#pin-ok', m.el).onclick = ok;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    $('#pin-no', m.el).onclick = () => { m.close(); resolve(null); };
  });
}

/** Aktion mit PIN ausführen. Gibt die Antwort zurück oder null. */
async function withPin(title, action, body) {
  if (!needPerson()) return null;
  const pin = await askPin(title);
  if (!pin) return null;
  try {
    const r = await api(action, { ...body, person: me, pin });
    pinCache = { person: me, pin, until: Date.now() + 5 * 60_000 };
    if (r.state) { state = r.state; renderAll(); }
    if (r.message) toast(r.message);
    return r;
  } catch (e) {
    if (/PIN/.test(e.message)) pinCache = { person: '', pin: '', until: 0 };
    toast(e.message, true);
    return null;
  }
}

// ---------- Darstellung ----------

function renderAll() {
  renderWho();
  renderStatus($('#status'), state);
  const d = state.device;
  $('#device').innerHTML = !d
    ? '<p class="muted">Der Laptop hat sich noch nie gemeldet.</p>'
    : `<p>${d.online ? '🟢 verbunden' : '⚪ nicht verbunden'} · zuletzt ${esc(when(d.lastPoll))}</p>
       <p class="muted small">Ludwig ${d.session === 'active' ? 'ist angemeldet und aktiv' : d.session === 'locked' ? 'ist angemeldet, Bildschirm gesperrt' : 'ist nicht angemeldet'}${state.pause.activeSoFarMinutes ? ` · seit ${fmtMin(state.pause.activeSoFarMinutes)} ohne Pause` : ''}</p>`;
  $('#penalties').innerHTML = renderPenalties(state, true);
  const cl = state.checklist;
  $('#checklist').innerHTML = cl.items.length
    ? `<ul class="list">${cl.items.map((i) => `<li>${i.checked ? '✅' : '⬜️'} ${esc(i.label)}</li>`).join('')}</ul>`
    : '<p class="muted">Heute keine Punkte.</p>';
  $('#week').innerHTML = renderWeek(state);
  $('#exams').innerHTML = renderExams(state, true);
  renderCatalog();
  renderLogFilters();
  if (currentTab === 'log' && !logFiltered) $('#log').innerHTML = renderLog(state.log);
  if (currentTab === 'settings' && !settingsDirty) renderSettings();
  updateDayCurrent();
}

function renderCatalog() {
  $('#mode-help').textContent = mode === 'A'
    ? 'Sperrt die nächsten Minuten Medienzeit ab jetzt. Läuft schon eine Strafe, wird hinten angehängt.'
    : 'Die heutige Endzeit rückt nach vorne. Reicht die Zeit heute nicht, wird der Rest morgen am Anfang abgezogen.';
  $('#catalog').innerHTML = state.catalog.map((c) => `
    <button class="penalty-btn" data-cat="${c.id}">
      <span>${esc(c.label)}</span><span class="min">${c.special === 'reset_checklist' ? 'Checkliste + ' : ''}${fmtMin(c.minutes)}</span>
    </button>`).join('');
}

// ---------- Tabs ----------

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  currentTab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== currentTab));
  if (currentTab === 'settings') { settingsDirty = false; renderSettings(); }
  if (currentTab === 'log' && !logFiltered) $('#log').innerHTML = renderLog(state.log);
  window.scrollTo(0, 0);
});

// ---------- Strafe ----------

$('#mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  mode = b.dataset.mode;
  document.querySelectorAll('#mode button').forEach((x) => x.classList.toggle('on', x === b));
  renderCatalog();
});

$('#catalog').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b || !needPerson()) return;
  const cat = state.catalog.find((c) => c.id === Number(b.dataset.cat));
  let preview;
  try {
    preview = await api('preview', { catalogId: cat.id, mode, person: me });
  } catch (err) { toast(err.message, true); return; }
  const m = modal(`
    <h2>${esc(cat.label)} – ${fmtMin(cat.minutes)}</h2>
    <p class="muted small">${cat.special === 'reset_checklist' ? 'Checkliste wird zurückgesetzt' : mode === 'A' ? 'Sofort' : 'Heute früher Schluss'} · eingetragen von ${esc(me)}</p>
    <div class="effect">${esc(preview.text)}</div>
    <div class="row"><button class="secondary" id="m-no">Abbrechen</button><button class="danger" id="m-ok">Bestätigen</button></div>`);
  $('#m-no', m.el).onclick = m.close;
  $('#m-ok', m.el).onclick = async () => {
    $('#m-ok', m.el).disabled = true;
    try {
      const r = await api('penalty', { catalogId: cat.id, mode, person: me });
      state = r.state;
      renderAll();
      m.close();
      toast(r.message);
    } catch (err) { toast(err.message, true); $('#m-ok', m.el).disabled = false; }
  };
});

// ---------- Strafe verringern ----------

$('#penalties').addEventListener('click', (e) => {
  const b = e.target.closest('[data-reduce]');
  if (!b || !needPerson()) return;
  const p = state.penalties.find((x) => x.id === Number(b.dataset.reduce));
  if (!p) return;
  const m = modal(`
    <h2>Strafe verringern</h2>
    <p>${esc(p.label)} (${esc(p.person)}) – noch <b>${fmtMin(p.remainingMinutes)}</b></p>
    <div class="chips">
      <button class="chip" data-r="10">−10</button><button class="chip" data-r="15">−15</button>
      <button class="chip" data-r="20">−20</button><button class="chip" data-r="30">−30</button>
      <button class="chip" data-r="all">ganz aufheben</button>
    </div>
    <label>Minuten</label><input type="number" inputmode="numeric" id="r-min" min="1">
    <label>Begründung</label><input id="r-reason" placeholder="z. B. Spülmaschine ausgeräumt">
    <p></p><div class="row"><button class="secondary" id="r-no">Abbrechen</button><button id="r-ok">Verringern (PIN)</button></div>`);
  let all = false;
  m.el.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-r]');
    if (!c) return;
    all = c.dataset.r === 'all';
    m.el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === c));
    $('#r-min', m.el).value = all ? '' : c.dataset.r;
  });
  $('#r-min', m.el).addEventListener('input', () => { all = false; m.el.querySelectorAll('[data-r]').forEach((x) => x.classList.remove('on')); });
  $('#r-no', m.el).onclick = m.close;
  $('#r-ok', m.el).onclick = async () => {
    const minutes = all ? null : Number($('#r-min', m.el).value);
    if (!all && !(minutes > 0)) { toast('Bitte Minuten angeben oder „ganz aufheben“ wählen.', true); return; }
    const reason = $('#r-reason', m.el).value;
    if (!reason.trim()) { toast('Bitte eine Begründung angeben.', true); return; }
    m.close();
    await withPin('Strafe verringern', 'reduce', { penaltyId: p.id, minutes, reason });
  };
});

// ---------- Mehr Zeit ----------

$('#grant-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-min]');
  if (!b) return;
  $('#grant-min').value = b.dataset.min;
  document.querySelectorAll('#grant-chips .chip').forEach((x) => x.classList.toggle('on', x === b));
});

$('#grant-go').addEventListener('click', async () => {
  const minutes = Number($('#grant-min').value);
  const reason = $('#grant-reason').value;
  if (!(minutes > 0)) return toast('Bitte Minuten angeben.', true);
  if (!reason.trim()) return toast('Bitte eine Begründung angeben.', true);
  const r = await withPin('Sonderfreigabe', 'grant', { minutes, reason });
  if (r) { $('#grant-min').value = ''; $('#grant-reason').value = ''; }
});

function updateDayCurrent() {
  const date = $('#day-date').value;
  const d = state && state.days.find((x) => x.date === date);
  $('#day-current').textContent = d ? `Bisher: ${d.start}–${d.end} Uhr${d.school ? ' (Schultag)' : ''}` : '';
}
$('#day-date').addEventListener('change', updateDayCurrent);

$('#day-go').addEventListener('click', async () => {
  const body = { date: $('#day-date').value, start: $('#day-start').value || undefined, end: $('#day-end').value || undefined, reason: $('#day-reason').value };
  if (!body.date) return toast('Bitte einen Tag wählen.', true);
  if (!body.start && !body.end) return toast('Bitte Start oder Ende angeben.', true);
  if (!body.reason.trim()) return toast('Bitte eine Begründung angeben.', true);
  const r = await withPin('Zeit ändern', 'day', body);
  if (r) { $('#day-start').value = ''; $('#day-end').value = ''; $('#day-reason').value = ''; }
});

// ---------- Klausuren ----------

$('#exam-go').addEventListener('click', async () => {
  if (!needPerson()) return;
  try {
    const r = await api('exam', { person: me, date: $('#exam-date').value, kind: $('#exam-kind').value, subject: $('#exam-subject').value });
    state = r.state; renderAll(); toast(r.message);
    $('#exam-subject').value = '';
  } catch (e) { toast(e.message, true); }
});

$('#exams').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-exam-del]');
  if (!b || !needPerson()) return;
  if (!confirm('Diesen Eintrag löschen?')) return;
  try {
    const r = await api('exam-delete', { person: me, id: Number(b.dataset.examDel) });
    state = r.state; renderAll(); toast(r.message);
  } catch (err) { toast(err.message, true); }
});

// ---------- Protokoll ----------

let logFiltered = false;
function renderLogFilters() {
  const sel = $('#log-person');
  if (sel.options.length > 1) return;
  for (const p of [...state.persons, 'Ludwig', 'Laptop']) sel.add(new Option(p, p));
}

$('#log-go').addEventListener('click', async () => {
  const q = new URLSearchParams();
  for (const [k, id] of [['person', '#log-person'], ['kind', '#log-kind'], ['from', '#log-from'], ['to', '#log-to']]) if ($(id).value) q.set(k, $(id).value);
  try {
    const r = await api(`log?${q}`);
    logFiltered = true;
    $('#log').innerHTML = renderLog(r.log);
  } catch (e) { toast(e.message, true); }
});

// ---------- Einstellungen ----------

function renderSettings() {
  const s = state.settings;
  $('#settings').innerHTML = `
    <section class="card" id="set-times">
      <h2>Zeiten</h2>
      <h3>Früheste Startzeit an Schultagen (Schulschluss)</h3>
      <div class="grid2">${WD.map((w, i) => `<div><label>${w}</label><input type="time" data-es="${i + 1}" value="${minToTime(s.earliestStart[String(i + 1)])}"></div>`).join('')}</div>
      <h3>Freie Tage und Endzeiten</h3>
      <div class="grid2">
        <div><label>Start an freien Tagen</label><input type="time" id="s-free" value="${minToTime(s.freeDayStart)}"></div>
        <div><label>Ende vor Schultagen</label><input type="time" id="s-endS" value="${minToTime(s.endBeforeSchool)}"></div>
        <div><label>Ende sonst</label><input type="time" id="s-endO" value="${minToTime(s.endOtherwise)}"></div>
      </div>
      <h3>Pausen, Laptop, Lernen</h3>
      <div class="grid2">
        <div><label>Pause nach … Min. aktiv</label><input type="number" id="s-pa" value="${s.pauseActiveMinutes}"></div>
        <div><label>Pause dauert … Min.</label><input type="number" id="s-pm" value="${s.pauseMinutes}"></div>
        <div><label>Als Pause zählt ab … Min.</label><input type="number" id="s-pb" value="${s.pauseBreakMinutes}"></div>
        <div><label>Vorwarnung … Min.</label><input type="number" id="s-warn" value="${s.warnMinutes}"></div>
        <div><label>Offline gilt Plan … Min.</label><input type="number" id="s-off" value="${s.offlineMinutes}"></div>
        <div><label>Lerntage vor Klausur</label><input type="number" id="s-ex" value="${s.examDays}"></div>
        <div><label>Lerntage vor Test</label><input type="number" id="s-te" value="${s.testDays}"></div>
      </div>
      <p></p><button data-save="settings">Zeiten speichern (PIN)</button>
    </section>

    <section class="card" id="set-hol"><details>
      <summary><b>Ferien und Feiertage</b> <span class="muted small">(antippen zum Bearbeiten)</span></summary>
      <div id="hol-rows">${state.holidays.map(holRow).join('')}</div>
      <button class="secondary" id="hol-add">+ Zeitraum hinzufügen</button><p></p>
      <button data-save="holidays">Ferien speichern (PIN)</button>
    </details></section>

    <section class="card" id="set-items"><details>
      <summary><b>Checkliste</b> <span class="muted small">(antippen zum Bearbeiten)</span></summary>
      <div id="item-rows">${state.items.map(itemRow).join('')}</div>
      <button class="secondary" id="item-add">+ Punkt hinzufügen</button><p></p>
      <button data-save="items">Checkliste speichern (PIN)</button>
    </details></section>

    <section class="card" id="set-cat"><details>
      <summary><b>Strafenkatalog</b> <span class="muted small">(antippen zum Bearbeiten)</span></summary>
      <div id="cat-rows">${state.catalog.map(catRow).join('')}</div>
      <button class="secondary" id="cat-add">+ Regel hinzufügen</button><p></p>
      <button data-save="catalog">Strafenkatalog speichern (PIN)</button>
    </details></section>

    <section class="card">
      <h2>Personen und PINs</h2>
      <p class="muted small">Personen und PINs stehen im GitHub-Secret <b>PINS</b> (siehe README, „PIN ändern“). Aktuell: ${state.persons.map(esc).join(', ')}.</p>
    </section>`;
}

const holRow = (h = { label: '', from: '', to: '' }) => `
  <div class="edit-row" data-row="hol">
    <input data-f="label" placeholder="z. B. Sommerferien" value="${esc(h.label)}">
    <div class="row" style="margin-top:6px"><input type="date" data-f="from" value="${esc(h.from)}"><input type="date" data-f="to" value="${esc(h.to)}"></div>
    <button class="ghost" data-del>Entfernen</button>
  </div>`;

const itemRow = (i = { label: '', condition: 'always' }) => `
  <div class="edit-row" data-row="item" data-id="${i.id || ''}">
    <input data-f="label" value="${esc(i.label)}" placeholder="z. B. Zimmer aufgeräumt">
    <select data-f="condition" style="margin-top:6px">${Object.entries(COND).map(([k, v]) => `<option value="${k}" ${k === i.condition ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <button class="ghost" data-del>Entfernen</button>
  </div>`;

const catRow = (c = { label: '', logText: '', minutes: 30, hint: '', special: null }) => `
  <div class="edit-row" data-row="cat" data-id="${c.id || ''}">
    <label>Knopf-Text</label><input data-f="label" value="${esc(c.label)}">
    <label>Text im Protokoll</label><input data-f="logText" value="${esc(c.logText)}" placeholder="z. B. Rumgeschrien">
    <div class="grid2">
      <div><label>Minuten</label><input type="number" data-f="minutes" value="${c.minutes}"></div>
      <div><label>Hinweis (optional)</label><input data-f="hint" value="${esc(c.hint || '')}"></div>
    </div>
    <label><input type="checkbox" data-f="special" ${c.special === 'reset_checklist' ? 'checked' : ''}> setzt die Checkliste zurück</label>
    <button class="ghost" data-del>Entfernen</button>
  </div>`;

$('#settings').addEventListener('input', () => { settingsDirty = true; });
$('#settings').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.matches('[data-del]')) { t.closest('.edit-row').remove(); settingsDirty = true; return; }
  if (t.id === 'hol-add') { $('#hol-rows').insertAdjacentHTML('beforeend', holRow()); settingsDirty = true; return; }
  if (t.id === 'item-add') { $('#item-rows').insertAdjacentHTML('beforeend', itemRow()); settingsDirty = true; return; }
  if (t.id === 'cat-add') { $('#cat-rows').insertAdjacentHTML('beforeend', catRow()); settingsDirty = true; return; }
  const section = t.dataset.save;
  if (!section) return;
  const val = (row, f) => row.querySelector(`[data-f="${f}"]`);
  let body;
  if (section === 'settings') {
    const es = {};
    document.querySelectorAll('[data-es]').forEach((x) => { es[x.dataset.es] = timeToMin(x.value); });
    body = { settings: {
      earliestStart: es,
      freeDayStart: timeToMin($('#s-free').value),
      endBeforeSchool: timeToMin($('#s-endS').value),
      endOtherwise: timeToMin($('#s-endO').value),
      pauseActiveMinutes: Number($('#s-pa').value),
      pauseMinutes: Number($('#s-pm').value),
      pauseBreakMinutes: Number($('#s-pb').value),
      warnMinutes: Number($('#s-warn').value),
      offlineMinutes: Number($('#s-off').value),
      examDays: Number($('#s-ex').value),
      testDays: Number($('#s-te').value),
    } };
  } else if (section === 'holidays') {
    body = { holidays: [...document.querySelectorAll('[data-row="hol"]')].map((r) => ({ label: val(r, 'label').value, from: val(r, 'from').value, to: val(r, 'to').value })) };
  } else if (section === 'items') {
    body = { items: [...document.querySelectorAll('[data-row="item"]')].map((r) => ({ id: Number(r.dataset.id) || undefined, label: val(r, 'label').value, condition: val(r, 'condition').value })) };
  } else if (section === 'catalog') {
    body = { catalog: [...document.querySelectorAll('[data-row="cat"]')].map((r) => ({
      id: Number(r.dataset.id) || undefined,
      label: val(r, 'label').value,
      logText: val(r, 'logText').value,
      minutes: Number(val(r, 'minutes').value),
      hint: val(r, 'hint').value,
      special: val(r, 'special').checked ? 'reset_checklist' : null,
    })) };
  }
  const r = await withPin('Einstellungen speichern', 'settings', body);
  if (r) { settingsDirty = false; renderSettings(); }
});

// ---------- Start ----------

async function refresh() {
  try {
    const s = await api('state');
    state = s;
    serverOffset = s.serverTime - Date.now();
    renderAll();
    choosePerson(false);
  } catch (e) { toast(e.message, true); }
}
window.refresh = refresh;

const todayIso = isoDate(Date.now());
$('#day-date').value = todayIso;
$('#exam-date').value = todayIso;
refresh();
startPolling(refresh, 30000);
