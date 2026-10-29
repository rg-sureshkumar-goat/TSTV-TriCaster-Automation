// The simulator page. Shows only what TSTV uses, set up like TSTV's TC1: program runs through M/E 1
// (cameras on its A row), the green screen is M/E 2 (a camera keyed over GFX 1), and DSK 2 shows
// DDR 2 with AutoPlay. Buttons act like the TD at the panel; the fake TC1 behind the page is complete.
'use strict';

const $ = (id) => document.getElementById(id);

/**
 * Replaces a section only when its content changed. While a clip plays the page updates many times a
 * second; leaving unchanged buttons alone means a press is never lost to a redraw.
 */
const shown = new Map();
function setHtml(id, html) {
  if (shown.get(id) === html) return;
  shown.set(id, html);
  $(id).innerHTML = html;
}
const PROGRAM_ME = 'v1';
const GREEN_SCREEN_ME = 'v2';
let state = null;

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function time(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Turns "INPUT2", "input2", "1" (a TC1 source number) or "V2" into the simulator's source id. */
function sourceId(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (/^-?\d+$/.test(v)) return Object.entries(state.switcher.sourceIndex).find(([, i]) => i === Number(v))?.[0] ?? v;
  return v;
}

function label(value) {
  const id = sourceId(value);
  const camera = state.switcher.cameras.find((c) => c.id === id);
  if (camera) return camera.label;
  if (id === PROGRAM_ME) return 'M/E 1 (cameras)';
  if (id === GREEN_SCREEN_ME) return 'Green screen (M/E 2)';
  const named = { ddr1: 'DDR 1 (A)', ddr2: 'DDR 2 (B)', gfx1: 'GFX 1', gfx2: 'GFX 2', black: 'Black', bfr11: 'the bug' }[id];
  return named ?? id.replace(/^input(\d+)$/, 'Input $1').toUpperCase();
}

function currentClip(player) {
  return player.playlist[player.index];
}

/** "A2_VO_Basketball 0:12 / 0:25" for a player, or "nothing loaded". */
function clipText(player) {
  const clip = currentClip(player);
  if (!clip) return 'nothing loaded';
  if (!clip.durationMs) return clip.name;
  return `${clip.name}  ${time(player.positionMs)} / ${time(clip.durationMs)}`;
}

/** Plain-English description of a command, for the log. */
function describe(c) {
  const v = c.value;
  const n = (x) => Number.parseInt(String(x).split('|')[0], 10) + 1;
  const table = {
    main_a_row: () =>
      sourceId(v) === GREEN_SCREEN_ME ? 'Took the green screen to air' : sourceId(v) === PROGRAM_ME ? 'Took the cameras (M/E 1) back to air' : `Put ${label(v)} straight on program`,
    main_b_row: () => `Put ${label(v)} in preview`,
    main_take: () => 'Swapped program and preview',
    main_auto: () => 'Swapped program and preview (transition)',
    main_background_take: () => 'Swapped program and preview',
    main_background_auto: () => 'Swapped program and preview (transition)',
    v1_a_row: () => `Switched to ${label(v)}`,
    v2_a_row: () => `Put ${label(v)} on the green screen`,
    v2_b_row: () => `Set the green-screen background to ${label(v)}`,
    main_dsk2_take: () => 'Switched DSK 2 on or off',
    main_dsk2_auto: () => 'Switched DSK 2 on or off (transition)',
    main_dsk2_value: () => (v === '1' ? 'Put DSK 2 on air' : 'Took DSK 2 off air'),
    main_dsk2_select: () => `Set DSK 2 to show ${label(v)}`,
    ddr2_play: () => 'Played DDR 2',
    ddr2_stop: () => 'Stopped DDR 2',
    ddr2_play_toggle: () => 'Played or paused DDR 2',
    ddr2_select_index: () => `Cued DDR 2 item ${n(v)}`,
    ddr2_select_clips: () => `Cued DDR 2 item ${n(v)}`,
    ddr2_back: () => 'Moved DDR 2 back one item',
    ddr2_forward: () => 'Moved DDR 2 forward one item',
    gfx1_select_index: () => `Loaded GFX 1 item ${n(v)} (green-screen background)`,
    gfx1_select_clips: () => `Loaded GFX 1 item ${n(v)} (green-screen background)`,
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

async function press(name, value) {
  await post('panel', { name, value });
}

/** A camera button: switch M/E 1 to that camera, and bring M/E 1 back to program if the green screen was up. */
async function takeCamera(id) {
  await press('v1_a_row', id.toUpperCase());
  if (state.switcher.program !== PROGRAM_ME) await press('main_a_row', 'V1');
}

function render() {
  if (!state) return;
  const sw = state.switcher;
  const ddr2 = sw.players.ddr2;
  const gfx1 = sw.players.gfx1;
  const camerasMe = sw.mes[PROGRAM_ME];
  const green = sw.mes[GREEN_SCREEN_ME];
  const dsk = sw.dsks.main_dsk2;
  const dskPlayer = sw.players[dsk.source];
  const greenOnAir = sw.program === GREEN_SCREEN_ME;
  const camerasOnAir = sw.program === PROGRAM_ME;
  const appConnected = state.connections.stateStream + state.connections.notifications > 0;
  const background = currentClip(gfx1)?.name ?? 'GFX 1';

  // Program monitor
  let main;
  if (greenOnAir) main = `<div class="main">${esc(label(green.a))}</div><div class="sub">on the green screen, over ${esc(background)}</div>`;
  else if (camerasOnAir) main = `<div class="main">${esc(label(camerasMe.a))}</div>`;
  else main = `<div class="main">${esc(label(sw.program))}</div>`;
  let screen = `<div>${main}</div>`;
  if (dsk.onAir) screen += `<div class="overlay">DSK 2: ${esc(dskPlayer ? clipText(dskPlayer) : label(dsk.source))}</div>`;
  setHtml('screen', screen);

  // On air now
  const row = (term, value, live = false) => `<dt>${term}</dt><dd class="${live ? 'live' : ''}">${value}</dd>`;
  const programText = greenOnAir ? `Green screen: ${label(green.a)}` : camerasOnAir ? label(camerasMe.a) : label(sw.program);
  setHtml('on-air', [
    row('Program', esc(programText)),
    row('DSK 2', dsk.onAir ? esc(dskPlayer ? currentClip(dskPlayer)?.name ?? 'on' : label(dsk.source)) : 'Off', dsk.onAir),
    row('Recording', sw.recording.on ? `● ${time(sw.recording.seconds * 1000)}` : 'Off', sw.recording.on),
    // The Sound player plays the show's music (Phase 4).
    row('Sound player', sw.players.sound?.playing ? `♪ ${esc(currentClip(sw.players.sound)?.name ?? 'Playing')}` : 'Stopped', Boolean(sw.players.sound?.playing)),
    row('Show app', appConnected ? 'Connected' : 'Not connected'),
  ].join(''));

  // Controls
  setHtml('cameras', sw.cameras
    .map((c) => `<button data-camera="${c.id}" class="${camerasOnAir && camerasMe.a === c.id ? 'on' : ''}">${esc(c.label)}</button>`)
    .join(''));
  setHtml('green-screen', `<button data-cmd="main_a_row" data-value="V2" class="${greenOnAir ? 'on' : ''}">${greenOnAir ? 'On air' : 'Take to air'}</button>
    <span class="muted">keyed camera:</span>
    ${sw.cameras
      .map((c) => `<button class="small ${green.a === c.id ? 'selected' : ''}" data-cmd="v2_a_row" data-value="${c.id.toUpperCase()}">${esc(c.label.replace(/ \(.*\)$/, ''))}</button>`)
      .join('')}
    <span class="muted">over ${esc(background)}</span>`);
  setHtml('dsk2', `<button data-cmd="main_dsk2_take" class="${dsk.onAir ? 'on' : ''}">${dsk.onAir ? 'On air: take off' : 'Off: take on'}</button>
    <span class="muted">Shows DDR 2. Taking it on plays the cued clip; taking it off stops and cues the next one.</span>`);

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
  setHtml('ddr2', `<ol>${items || '<li class="muted">Playlist is empty</li>'}</ol>
    <div class="buttons">
      <button data-cmd="ddr2_play" class="${ddr2.playing ? 'on' : ''}">Play</button>
      <button data-cmd="ddr2_stop">Stop</button>
    </div>`);

  setHtml('record', `<button data-cmd="record_toggle" class="${sw.recording.on ? 'on' : ''}">${sw.recording.on ? `● Recording ${time(sw.recording.seconds * 1000)}: stop` : '● Record'}</button>`);

  // What the show app sent (commands that came over the network, not clicks on this page)
  const fromApp = state.log.filter((c) => c.source === 'http' || c.source === 'tcp' || c.source === 'macro');
  setHtml('log',
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
      .join('') || '<li><span class="empty">Nothing yet. Commands from the show app (or anything else on the network) appear here.</span></li>',
  );

  // Practice problems: keep what's typed while someone is editing
  const f = state.faults;
  $('fault-offline').checked = f.offline;
  $('fault-drop').checked = f.dropCommands;
  if (document.activeElement !== $('fault-latency')) $('fault-latency').value = f.latencyMs;
  if (document.activeElement !== $('fault-password')) $('fault-password').value = f.password ?? '';
  $('end-clip').disabled = !ddr2.playing;
}

function activate(event) {
  const camera = event.target.closest('[data-camera]');
  if (camera) return void takeCamera(camera.dataset.camera);
  const el = event.target.closest('[data-cmd]');
  if (el && !el.disabled) press(el.dataset.cmd, el.dataset.value);
}

// Buttons act the moment they're pressed, like panel buttons, so a redraw before release can't lose the press.
document.addEventListener('pointerdown', (event) => {
  if (event.button === 0) activate(event);
});
// Keyboard users (Tab, then Enter or Space) still get a click event with no pointer.
document.addEventListener('click', (event) => {
  if (event.detail === 0) activate(event);
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
