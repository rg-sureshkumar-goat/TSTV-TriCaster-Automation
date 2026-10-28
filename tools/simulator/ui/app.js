// The simulator page. Shows only what TSTV uses: the three cameras, the green screen (M/E 2 over GFX 1),
// DSK 2 with the DDR 2 playlist, and recording. Buttons act like the TD at the panel. The fake TC1 behind
// the page still behaves like the full switcher.
'use strict';

const $ = (id) => document.getElementById(id);
const CAMERAS = ['input1', 'input2', 'input3'];
const GREEN_SCREEN_ME = 'v2';
let state = null;

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function time(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function label(source) {
  const input = state.switcher.inputs.find((i) => i.id === source);
  if (input) return input.longName;
  if (source === GREEN_SCREEN_ME) return 'Green screen';
  return { ddr1: 'DDR 1', ddr2: 'DDR 2', gfx1: 'GFX 1', gfx2: 'GFX 2', v1: 'M/E 1', v3: 'M/E 3', v4: 'M/E 4', black: 'Black' }[source] ?? source;
}

function currentClip(player) {
  return player.playlist[player.index];
}

/** "B5_VO_Basketball 0:12 / 0:25" for a player, or "nothing loaded". */
function clipText(player) {
  const clip = currentClip(player);
  if (!clip) return 'nothing loaded';
  if (!clip.durationMs) return clip.name;
  return `${clip.name}  ${time(player.positionMs)} / ${time(clip.durationMs)}`;
}

/** Plain-English description of a command, for the log. */
function describe(c) {
  const v = c.value;
  const n = (x) => Number(x) + 1;
  const table = {
    main_a_row: () => (v === GREEN_SCREEN_ME ? 'Took the green screen to air' : `Took ${label(v)} to air`),
    main_b_row: () => `Put ${label(v)} in preview`,
    main_take: () => 'Swapped program and preview',
    main_auto: () => 'Swapped program and preview',
    main_background_take: () => 'Swapped program and preview',
    main_background_auto: () => 'Swapped program and preview',
    main_dsk2_take: () => 'Switched DSK 2 on or off',
    main_dsk2_auto: () => 'Switched DSK 2 on or off',
    main_dsk2_value: () => (v === '1' ? 'Put DSK 2 on air' : 'Took DSK 2 off air'),
    main_dsk2_select: () => `Set DSK 2 to show ${label(v)}`,
    ddr2_play: () => 'Played DDR 2',
    ddr2_stop: () => 'Stopped DDR 2',
    ddr2_play_toggle: () => 'Played or paused DDR 2',
    ddr2_select_index: () => `Cued DDR 2 item ${n(v)}`,
    ddr2_back: () => 'Moved DDR 2 back one item',
    ddr2_forward: () => 'Moved DDR 2 forward one item',
    gfx1_select_index: () => `Loaded GFX 1 item ${n(v)} (green-screen background)`,
    record_toggle: () => (v === '1' ? 'Started recording' : v === '0' ? 'Stopped recording' : 'Started or stopped recording'),
    record_start: () => 'Started recording',
    record_stop: () => 'Stopped recording',
    play_macro_byname: () => `Ran the macro "${v}"`,
  };
  return table[c.name]?.() ?? (c.result === 'unknown' ? `Unknown command "${c.name}"` : `Other command: ${c.name}`);
}

async function post(route, body) {
  await fetch(`/sim/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

const press = (name, value) => post('panel', { name, value });

function render() {
  if (!state) return;
  const sw = state.switcher;
  const ddr2 = sw.players.ddr2;
  const gfx1 = sw.players.gfx1;
  const me = sw.mes[GREEN_SCREEN_ME];
  const dsk = sw.dsks.main_dsk2;
  const dskPlayer = sw.players[dsk.source];
  const greenOnAir = sw.program === GREEN_SCREEN_ME;
  const appConnected = state.connections.stateStream + state.connections.notifications > 0;

  // Program monitor
  let screen = greenOnAir
    ? `<div><div class="main">${esc(label(me.key))}</div><div class="sub">on the green screen, over ${esc(currentClip(gfx1)?.name ?? 'GFX 1')}</div></div>`
    : `<div><div class="main">${esc(label(sw.program))}</div></div>`;
  if (dsk.onAir) screen += `<div class="overlay">DSK 2: ${esc(dskPlayer ? clipText(dskPlayer) : label(dsk.source))}</div>`;
  $('screen').innerHTML = screen;

  // On air now
  const row = (term, value, live = false) => `<dt>${term}</dt><dd class="${live ? 'live' : ''}">${value}</dd>`;
  $('on-air').innerHTML = [
    row('Program', esc(greenOnAir ? `Green screen (${label(me.key)})` : label(sw.program))),
    row('DSK 2', dsk.onAir ? esc(dskPlayer ? currentClip(dskPlayer)?.name ?? 'on' : label(dsk.source)) : 'Off', dsk.onAir),
    row('Recording', sw.recording.on ? `● ${time(sw.recording.seconds * 1000)}` : 'Off', sw.recording.on),
    row('Show app', appConnected ? 'Connected' : 'Not connected'),
  ].join('');

  // Controls
  $('cameras').innerHTML = CAMERAS.map(
    (id) => `<button data-cmd="main_a_row" data-value="${id}" class="${sw.program === id ? 'on' : ''}">${esc(label(id))}</button>`,
  ).join('');
  $('green-screen').innerHTML = `<button data-cmd="main_a_row" data-value="${GREEN_SCREEN_ME}" class="${greenOnAir ? 'on' : ''}">${greenOnAir ? 'On air' : 'Take to air'}</button>
    <span class="muted">${esc(label(me.key))} over ${esc(currentClip(gfx1)?.name ?? 'GFX 1')}</span>`;
  $('dsk2').innerHTML = `<button data-cmd="main_dsk2_take" class="${dsk.onAir ? 'on' : ''}">${dsk.onAir ? 'On air: take off' : 'Off: take on'}</button>`;

  const items = ddr2.playlist
    .map((clip, i) => {
      const current = i === ddr2.index;
      const pct = current && clip.durationMs ? Math.min(100, (ddr2.positionMs / clip.durationMs) * 100) : 0;
      return `<li data-cmd="ddr2_select_index" data-value="${i}" class="${current ? 'current' : ''}">
        <div class="item"><span>${current && ddr2.playing ? '▶ ' : ''}${i + 1}. ${esc(clip.name)}</span>
        <span class="muted">${current ? `${time(ddr2.positionMs)} / ` : ''}${time(clip.durationMs)}</span></div>
        ${current ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
      </li>`;
    })
    .join('');
  $('ddr2').innerHTML = `<ol>${items || '<li class="muted">Playlist is empty</li>'}</ol>
    <div class="buttons">
      <button data-cmd="ddr2_play" class="${ddr2.playing ? 'on' : ''}">Play</button>
      <button data-cmd="ddr2_stop">Stop</button>
    </div>`;

  $('record').innerHTML = `<button data-cmd="record_toggle" class="${sw.recording.on ? 'on' : ''}">${sw.recording.on ? `● Recording ${time(sw.recording.seconds * 1000)}: stop` : '● Record'}</button>`;

  // What the show app sent (commands that came over the network, not clicks on this page)
  const fromApp = state.log.filter((c) => c.source === 'http' || c.source === 'tcp' || c.source === 'macro');
  $('log').innerHTML =
    fromApp
      .map((c) => {
        const problem = c.result !== 'ok';
        const at = new Date(c.at).toLocaleTimeString([], { hour12: false });
        const raw = `${c.name}${c.value !== undefined ? ` = ${c.value}` : ''}${c.guessedName ? ' · name not confirmed on the TC1 yet' : ''}`;
        return `<li class="${problem ? 'problem' : ''}">
          <span class="time">${at}</span>
          <span>${esc(describe(c))}${problem ? ` · not done: ${esc(c.note ?? c.result)}` : ''}<br><span class="raw">${esc(raw)}</span></span>
        </li>`;
      })
      .join('') || '<li><span class="empty">Nothing yet. Commands from the show app (or anything else on the network) appear here.</span></li>';

  // Practice problems: keep what's typed while someone is editing
  const f = state.faults;
  $('fault-offline').checked = f.offline;
  $('fault-drop').checked = f.dropCommands;
  if (document.activeElement !== $('fault-latency')) $('fault-latency').value = f.latencyMs;
  if (document.activeElement !== $('fault-password')) $('fault-password').value = f.password ?? '';
  $('end-clip').disabled = !ddr2.playing;
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-cmd]');
  if (el && !el.disabled) press(el.dataset.cmd, el.dataset.value);
});

$('fault-offline').addEventListener('change', (e) => post('faults', { offline: e.target.checked }));
$('fault-drop').addEventListener('change', (e) => post('faults', { dropCommands: e.target.checked }));
$('apply-latency').addEventListener('click', () => post('faults', { latencyMs: Number($('fault-latency').value) || 0 }));
$('apply-password').addEventListener('click', () => post('faults', { password: $('fault-password').value.trim() }));
$('end-clip').addEventListener('click', () => post('clip-end', { player: 'ddr2' }));
$('reset').addEventListener('click', () => post('reset'));
$('clear-log').addEventListener('click', () => post('clear-log'));

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sim/events`);
  ws.onopen = () => ($('link').textContent = 'Running');
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
