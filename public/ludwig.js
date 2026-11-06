'use strict';

let state = null;

function render() {
  renderStatus($('#status'), state);
  const cl = state.checklist;
  $('#checklist').innerHTML = cl.items.length
    ? cl.items.map((i) => `
        <div class="check ${i.checked ? 'on' : ''}" data-item="${i.id}" data-checked="${i.checked ? 1 : 0}" role="checkbox" aria-checked="${i.checked}">
          <div class="box">${i.checked ? '✓' : ''}</div><div class="lbl">${esc(i.label)}</div>
        </div>`).join('') + (cl.done ? '<p class="muted small" style="margin-top:10px">Alles erledigt – super!</p>' : '')
    : '<p class="muted">Heute steht nichts auf der Liste.</p>';
  $('#penalties').innerHTML = renderPenalties(state, false);
  $('#exams').innerHTML = renderExams(state, false);
  $('#week').innerHTML = renderWeek(state);
  $('#log').innerHTML = renderLog(state.log);
}

async function refresh() {
  try {
    state = await api('state');
    serverOffset = state.serverTime - Date.now();
    render();
  } catch (e) {
    toast(e.message, true);
  }
}
window.refresh = refresh;

$('#checklist').addEventListener('click', async (ev) => {
  const row = ev.target.closest('[data-item]');
  if (!row || row.dataset.busy) return;
  row.dataset.busy = '1';
  const checked = row.dataset.checked !== '1';
  row.classList.toggle('on', checked);
  try {
    const r = await api('check', { itemId: Number(row.dataset.item), checked });
    state = r.state;
    render();
  } catch (e) {
    toast(e.message, true);
    refresh();
  }
});

refresh();
startPolling(refresh, 30000);
