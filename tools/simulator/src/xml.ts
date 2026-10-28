// The XML the simulated TC1 sends, shaped like what Bitfocus Companion and node-tricaster read.
import { PRODUCT } from './profile.ts';
import type { MacroSpec } from './profile.ts';

export interface StateValue {
  value: string;
  type: 'string' | 'int' | 'bool';
}

export interface TallyColumn {
  index: number;
  name: string;
  onPgm: boolean;
  onPrev: boolean;
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
    `<product_name>${escapeXml(PRODUCT.name)}</product_name>`,
    `<product_version>${escapeXml(PRODUCT.version)}</product_version>`,
    `<machine_name>${escapeXml(PRODUCT.machine)}</machine_name>`,
    `<session_name>${escapeXml(PRODUCT.session)}</session_name>`,
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
    out += `<shortcut_state name="${escapeXml(name)}" value="${escapeXml(state.value)}" type="${state.type}" />`;
  }
  return `${out}</shortcut_states>`;
}

export function tallyXml(columns: TallyColumn[]): string {
  const rows = columns.map((c) => `<column index="${c.index}" name="${escapeXml(c.name)}" on_pgm="${c.onPgm}" on_prev="${c.onPrev}" />`);
  return `<tally>${rows.join('')}</tally>`;
}

export function switcherXml(program: string, preview: string): string {
  return `<switcher_update main_source="${escapeXml(program)}" preview_source="${escapeXml(preview)}" />`;
}

export function macrosXml(macros: MacroSpec[]): string {
  const list = (folder: MacroSpec['folder']) =>
    macros
      .filter((m) => m.folder === folder)
      .map((m) => `<macro name="${escapeXml(m.name)}" />`)
      .join('');
  return `<macros><systemfolder>${list('system')}</systemfolder><sessionfolder>${list('session')}</sessionfolder></macros>`;
}

export function effectsXml(): string {
  return '<switcher_ui_effects><effect name="Fade" index="0" /></switcher_ui_effects>';
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
