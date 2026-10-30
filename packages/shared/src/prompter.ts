// What the prompter shows (Phase 3): every section that airs, in rundown order, as a list of lines. Each
// section starts with its number, who reads it and the camera to look at; cue chips become markers, and a
// speaker tag line like {JORDAN} becomes a speaker marker. Floated sections are skipped.
import * as Y from 'yjs';
import { breakCueId, isCrossTalk, type Element, type RundownTiming, type SectionRow } from './rundown.ts';
import { readScriptLines, scriptBody, speakerTagLine } from './script.ts';

export type PrompterLine =
  | { kind: 'block'; key: string; label: string; title: string }
  | { kind: 'break'; key: string; seconds: number }
  | { kind: 'section'; key: string; sectionId: string; label: string; slug: string; readers: string[]; camera: string }
  | { kind: 'crossTalk'; key: string; sectionId: string }
  | { kind: 'speaker'; key: string; sectionId: string; name: string }
  | { kind: 'text'; key: string; sectionId: string; text: string }
  | { kind: 'cue'; key: string; sectionId: string; element: Element }
  | { kind: 'end'; key: string };

/** The prompter's lines for an episode. Keys stay the same while scripts are edited around them. */
export function prompterLines(doc: Y.Doc, timing: RundownTiming, defaultCamera: string): PrompterLine[] {
  const lines: PrompterLine[] = [];
  for (const c of timing.rows) {
    if (c.breakBefore) lines.push({ kind: 'break', key: breakCueId(c.row.id), seconds: c.breakBefore.seconds });
    if (c.row.kind === 'block') {
      lines.push({ kind: 'block', key: c.row.id, label: c.label, title: c.row.title });
      continue;
    }
    const section = c.row as SectionRow;
    if (section.floated) continue;
    const sectionId = section.id;
    const crossTalk = isCrossTalk(section.talent);
    lines.push({ kind: 'section', key: sectionId, sectionId, label: c.label, slug: section.slug, readers: crossTalk ? [] : section.talent, camera: section.camera || defaultCamera });
    if (crossTalk) lines.push({ kind: 'crossTalk', key: `${sectionId}-cross-talk`, sectionId });
    const elements = new Map(section.elements.map((e) => [e.id, e]));
    const body = scriptBody(doc, sectionId);
    for (const { key, pieces } of body ? readScriptLines(body) : []) {
      const text = pieces.map((p) => (p.kind === 'text' ? p.text : '')).join('');
      pieces.forEach((p, i) => {
        // A cue for a graphic removed from the rundown has nothing to fire, so it isn't shown.
        const element = p.kind === 'cue' ? elements.get(p.elementId) : undefined;
        if (element) lines.push({ kind: 'cue', key: `${key}-${i}`, sectionId, element });
      });
      if (pieces.some((p) => p.kind === 'cue') && !text.trim()) continue;
      const speaker = speakerTagLine(text);
      lines.push(speaker ? { kind: 'speaker', key, sectionId, name: speaker } : { kind: 'text', key, sectionId, text });
    }
  }
  lines.push({ kind: 'end', key: 'end' });
  return lines;
}

/**
 * The cues at the very top of a section's script, before any words to read (speaker tags and empty lines
 * don't count), in order. The show app fires them as the section starts, rather than once the section's
 * number, camera and talent lines have scrolled past, so back-to-back teases play one after another with
 * no camera between them (RG, Oct 29, 2026).
 */
export function topCues(doc: Y.Doc, sectionId: string): string[] {
  const body = scriptBody(doc, sectionId);
  const cues: string[] = [];
  for (const { pieces } of body ? readScriptLines(body) : []) {
    // The prompter shows a line's cues above its words.
    for (const p of pieces) if (p.kind === 'cue') cues.push(p.elementId);
    const text = pieces.map((p) => (p.kind === 'text' ? p.text : '')).join('');
    if (text.trim() && !speakerTagLine(text)) break;
  }
  return cues;
}
