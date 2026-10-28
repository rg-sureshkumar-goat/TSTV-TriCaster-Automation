// The simulator page. It shows the fake switcher's state and sends "panel" presses, the way the TD
// would use the TC1SP. Commands from the show app arrive over the network instead and show in the log.
'use strict';

const $ = (id) => document.getElementById(id);
let state = null;
let names = {};

const SOURCE_LABELS = { ddr1: 'DDR 1', ddr2: 'DDR 2', gfx1: 'GFX 1', gfx2: 'GFX 2', v1: 'M/E 1', v2: 'M/E 2', v3: 'M/E 3', v4: 'M/E 4', black: 'Black' };
const FROM_LABELS = { http: 'Show app (web API)', tcp: 'Show app (state port)', panel: 'Simulator page', macro: 'Macro' };

function label(source) {
  return names[source] ?? SOURCE_LABELS[source] ?? source;
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function time(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function clipText(player) {
  const clip = player.playlist[player.index];
  if (!clip) return `${player.label}: empty`;
  if (player.stills || clip.durationMs === 0) return `${player.label}: ${clip.name}`;
  return `${player.label}: ${clip.name} · ${time(player.positionMs)} / ${time(clip.durationMs)}${player.playing ? ' ▶' : ''}`;
}

async function panel(name, value) {
  await fetch('/sim/api/panel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value }) });
}

async function post(route, body) {
  await fetch(`/sim/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

function sourcesList(sw) {
  return [...sw.inputs.map((i) => i.id), 'ddr1', 'ddr2', 'gfx1', 'gfx2', 'v1', 'v2', 'v3', 'v4', 'black'];
}

function screenHtml(sw, source, withDsks) {
  let html = `<div><div class="main-source">${esc(label(source))}</div>`;
  const me = sw.mes[source];
  if (me) html += `<div class="sub">${esc(label(me.key ?? me.b))} keyed over ${esc(label(me.a))}${sw.players[me.a] ? ` (${esc(clipText(sw.players[me.a]))})` : ''}</div>`;
  if (sw.players[source]) html += `<div class="sub">${esc(clipText(sw.players[source]))}</div>`;
  html += '</div>';
  if (withDsks) {
    const onAir = Object.entries(sw.dsks).filter(([, d]) => d.onAir);
    for (const [id, dsk] of onAir) {
      const player = sw.players[dsk.source];
      html += `<div class="overlay">${esc(id.replace('main_dsk', 'DSK '))}: ${esc(player ? clipText(player) : label(dsk.source))}</div>`;
    }
  }
  return html;
}

function render() {
  if (!state) return;
  const sw = state.switcher;
  names = Object.fromEntries(sw.inputs.map((i) => [i.id, i.longName]));

  $('pgm-screen').innerHTML = screenHtml(sw, sw.program, true);
  $('pvw-screen').innerHTML = screenHtml(sw, sw.preview, false);
  $('rec-badge').hidden = !sw.recording.on;

  const sources = sourcesList(sw);
  $('pgm-row').innerHTML = sources
    .map((s) => `<button data-cmd="main_a_row" data-value="${s}" class="${s === sw.program ? 'on-pgm' : ''}">${esc(label(s))}</button>`)
    .join('');
  $('pvw-row').innerHTML = sources
    .map((s) => `<button data-cmd="main_b_row" data-value="${s}" class="${s === sw.preview ? 'on-pvw' : ''}">${esc(label(s))}</button>`)
    .join('');

  const dsk = sw.dsks.main_dsk2;
  $('dsk-card').innerHTML = `
    <h2>DSK 2</h2>
    <p>Source: <strong>${esc(label(dsk.source))}</strong></p>
    <div class="buttons">
      <button data-cmd="main_dsk2_take" class="${dsk.onAir ? 'on-pgm' : ''}">${dsk.onAir ? 'ON AIR: take off' : 'Off air: take on'}</button>
      <button data-cmd="main_dsk2_select" data-value="ddr2" class="${dsk.source === 'ddr2' ? 'on' : ''}">Source DDR 2</button>
      <button data-cmd="main_dsk2_select" data-value="gfx2" class="${dsk.source === 'gfx2' ? 'on' : ''}">Source GFX 2</button>
    </div>`;

  const me = sw.mes.v2;
  $('me-card').innerHTML = `
    <h2>M/E 2 (green screen)</h2>
    <p>${esc(label(me.key ?? me.b))} keyed over <strong>${esc(label(me.a))}</strong></p>
    <div class="buttons">
      <button data-cmd="main_a_row" data-value="v2" class="${sw.program === 'v2' ? 'on-pgm' : ''}">M/E 2 to Program</button>
      <button data-cmd="v2_key" data-value="input1">Key Camera 1</button>
      <button data-cmd="v2_key" data-value="input3">Key Camera 3</button>
    </div>`;

  $('rec-card').innerHTML = `
    <h2>Recording</h2>
    <p>${sw.recording.on ? `<strong class="rec-badge">● Recording</strong> ${time(sw.recording.seconds * 1000)}` : 'Not recording'}</p>
    <div class="buttons"><button data-cmd="record_toggle" class="${sw.recording.on ? 'on-pgm' : ''}">${sw.recording.on ? 'Stop' : 'Record'}</button></div>
    <p class="muted">Macros: ${sw.macros.map((m) => `<button class="small" data-cmd="play_macro_byname" data-value="${esc(m.name)}">${esc(m.name)}</button>`).join(' ')}</p>`;

  $('players').innerHTML = Object.values(sw.players)
    .map((p) => {
      const clip = p.playlist[p.index];
      const pct = clip && clip.durationMs ? Math.min(100, (p.positionMs / clip.durationMs) * 100) : 0;
      const items = p.playlist
        .map((c, i) => `<li data-cmd="${p.id}_select_index" data-value="${i}" class="${i === p.index ? 'current' : ''}"><span>${i + 1}. ${esc(c.name)}</span><span class="muted">${c.durationMs ? time(c.durationMs) : 'still'}</span></li>`)
        .join('');
      const controls = p.stills
        ? `<button data-cmd="${p.id}_back">◀ Previous</button><button data-cmd="${p.id}_forward">Next ▶</button>`
        : `<button data-cmd="${p.id}_play" class="${p.playing ? 'on' : ''}">Play</button>
           <button data-cmd="${p.id}_stop">Stop</button>
           <button data-cmd="${p.id}_back">◀ Back</button>
           <button data-cmd="${p.id}_forward">Forward ▶</button>
           <button data-action="clip-end" data-player="${p.id}" class="secondary" ${p.playing ? '' : 'disabled'}>End clip now</button>`;
      return `<div class="card">
        <h2>${esc(p.label)}</h2>
        <div class="muted">${esc(clipText(p))}${clip && clip.durationMs ? ` · ${time(clip.durationMs - p.positionMs)} left` : ''}</div>
        ${p.stills ? '' : `<div class="progress"><div style="width:${pct}%"></div></div>`}
        <ul class="playlist">${items || '<li class="muted">Empty playlist</li>'}</ul>
        <div class="buttons">${controls}</div>
      </div>`;
    })
    .join('');

  const f = state.faults;
  if (document.activeElement !== $('fault-latency')) $('fault-latency').value = f.latencyMs;
  if (document.activeElement !== $('fault-password')) $('fault-password').value = f.password ?? '';
  $('fault-offline').checked = f.offline;
  $('fault-drop').checked = f.dropCommands;

  $('connections').textContent = `Connected now: ${state.connections.stateStream} on the state port (${state.ports.state}), ${state.connections.notifications} listening for change notifications.`;
  $('log').innerHTML =
    state.log
      .map(
        (c) => `<tr>
          <td>${new Date(c.at).toLocaleTimeString([], { hour12: false })}.${String(new Date(c.at).getMilliseconds()).padStart(3, '0')}</td>
          <td>${esc(FROM_LABELS[c.source] ?? c.source)}</td>
          <td>${esc(c.name)} ${c.guessedName ? '<span class="guess">guessed name</span>' : ''}</td>
          <td>${esc(c.value ?? '')}</td>
          <td class="result-${c.result}">${esc(c.result)}${c.note ? ` · ${esc(c.note)}` : ''}</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="5" class="muted">No commands yet.</td></tr>';
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-cmd], [data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.cmd) panel(el.dataset.cmd, el.dataset.value);
  else if (el.dataset.action === 'clip-end') post('clip-end', { player: el.dataset.player });
});

$('apply-faults').addEventListener('click', () =>
  post('faults', {
    offline: $('fault-offline').checked,
    dropCommands: $('fault-drop').checked,
    latencyMs: Number($('fault-latency').value) || 0,
    password: $('fault-password').value.trim(),
  }),
);
$('reset').addEventListener('click', () => post('reset'));
$('clear-log').addEventListener('click', () => post('clear-log'));

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sim/events`);
  ws.onopen = () => ($('link').textContent = 'Page connected');
  ws.onmessage = (event) => {
    state = JSON.parse(event.data);
    render();
  };
  ws.onclose = () => {
    $('link').textContent = 'Simulator stopped. Reconnecting…';
    setTimeout(connect, 1500);
  };
}
connect();
