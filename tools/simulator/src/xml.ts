// The XML the simulated TC1 sends. Shapes match what TSTV's real TC1 returned to the probe.
import { PRODUCT } from './profile.ts';
import type { MacroSpec } from './profile.ts';

export interface StateValue {
  value: string;
  /** The TC1 reports "int", "bool", "double", "string", or "" for named inputs. */
  type: 'string' | 'int' | 'bool' | 'double' | '';
}

export interface TallyColumn {
  index: number;
  name: string;
  onPgm: boolean;
  onPrev: boolean;
}

export interface PlayerXmlInfo {
  id: string;
  label: string;
  playlist: { name: string; durationMs: number }[];
  index: number;
  playing: boolean;
  positionMs: number;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

export function productInformationXml(): string {
  return [
    '<product_information>',
    `<product_model>${escapeXml(PRODUCT.model)}</product_model>`,
    `<product_name>${escapeXml(PRODUCT.name)}</product_name>`,
    `<product_version>${escapeXml(PRODUCT.version)}</product_version>`,
    `<product_build_no>7-7-${PRODUCT.build}</product_build_no>`,
    `<machine_name>${escapeXml(PRODUCT.machine)}</machine_name>`,
    `<session_name>${escapeXml(PRODUCT.session)}</session_name>`,
    '<session_x_resolution>1920</session_x_resolution>',
    '<session_y_resolution>1080</session_y_resolution>',
    '<session_frame_rate>59.940060</session_frame_rate>',
    '<simulator>true</simulator>',
    '</product_information>',
  ].join('');
}

export function buildXml(): string {
  return `<build number="${PRODUCT.build}" product="${escapeXml(PRODUCT.name)}" session="${escapeXml(PRODUCT.session)}" />\n`;
}

export function shortcutStatesXml(states: Iterable<[string, StateValue]>): string {
  let out = '<shortcut_states>';
  for (const [name, state] of states) {
    out += `<shortcut_state name="${escapeXml(name)}" value="${escapeXml(state.value)}" type="${state.type}" sender="unknown" />`;
  }
  return `${out}</shortcut_states>`;
}

export function tallyXml(columns: TallyColumn[]): string {
  const rows = columns.map((c) => `<column name="${escapeXml(c.name)}" index="${c.index}" on_pgm="${c.onPgm}" on_prev="${c.onPrev}" />`);
  return `<tally>${rows.join('')}</tally>`;
}

/** Program and preview as the TC1 names them ("V1", "INPUT2", "Black"), plus the main DSK overlays. */
export function switcherXml(program: string, preview: string, dsks: Record<string, { source: string; onAir: boolean }>): string {
  const name = (s: string) => (s === 'black' ? 'Black' : s.toUpperCase());
  const overlays = Object.values(dsks)
    .map((d, i) => `<overlay z_order_position="${i}" source="${escapeXml(name(d.source))}"><tbar position="${d.onAir ? 1 : 0}" /></overlay>`)
    .join('');
  return `<switcher_update main_source="${escapeXml(name(program))}" preview_source="${escapeXml(name(preview))}"><switcher_overlays>${overlays}</switcher_overlays></switcher_update>`;
}

export function macrosXml(macros: MacroSpec[]): string {
  const list = (folder: MacroSpec['folder']) =>
    macros
      .filter((m) => m.folder === folder)
      .map((m) => `<macro name="${escapeXml(m.name)}" />`)
      .join('');
  return `<macros><systemfolder>${list('system')}</systemfolder><sessionfolder name="Session Macros">${list('session')}</sessionfolder></macros>`;
}

export function effectsXml(): string {
  return '<switcher_ui_effects><switcher name="main"><effect_bin><effect0 effect="Fade" /></effect_bin></switcher></switcher_ui_effects>';
}

/** Each player's playlist, shaped like the TC1's ddr_playlist (files live in the session's Import folders). */
export function ddrPlaylistXml(players: PlayerXmlInfo[]): string {
  const seconds = (ms: number) => String(ms / 1000);
  const body = players
    .map((p) => {
      const clips = p.playlist
        .map((c) => {
          const folder = c.durationMs ? 'Clips' : 'Stills';
          const file = `D:\\Sessions\\Practice\\${folder}\\Import\\${c.name}${c.durationMs ? '.mov' : '.png'}`;
          const length = seconds(c.durationMs || 5000);
          return `<clip alias="${escapeXml(c.name)}" filename="${escapeXml(file)}" file_length="${length}" clip_length="${length}" />`;
        })
        .join('');
      return `<${p.id} custom_short_name="${escapeXml(p.label)}" custom_long_name="${escapeXml(p.label)}"><playlist contains_playhead="true" is_selected="true" preset_index="0" current_clip="${p.index}">${clips}</playlist></${p.id}>`;
    })
    .join('');
  return `<playlist>${body}</playlist>`;
}

/** Where each player is in its current clip, shaped like the TC1's ddr_timecode. */
export function ddrTimecodeXml(players: PlayerXmlInfo[]): string {
  const body = players
    .map((p) => {
      const clip = p.playlist[p.index];
      const duration = (clip?.durationMs || 5000) / 1000;
      const elapsed = Math.min(duration, p.positionMs / 1000);
      return `<${p.id} clip_seconds_elapsed="${elapsed}" clip_seconds_remaining="${duration - elapsed}" clip_in="0" clip_out="${duration}" file_duration="${duration}" play_speed="1" clip_index="${p.index}" num_clips="${p.playlist.length}" />`;
    })
    .join('');
  return `<timecode>${body}</timecode>`;
}

export function recordConfigurationXml(recording: boolean): string {
  return `<state is_recording="${recording}" />`;
}

/** Pulls `<shortcut name="…" value="…" />` commands out of text, as sent on port 5951 or in a POST body. */
export function parseShortcutCommands(text: string): { name: string; value?: string }[] {
  const commands: { name: string; value?: string }[] = [];
  for (const match of text.matchAll(/<shortcut\s([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of match[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = decodeXml(a[2]);
    if (attrs.name) commands.push({ name: attrs.name, value: attrs.value });
  }
  return commands;
}
