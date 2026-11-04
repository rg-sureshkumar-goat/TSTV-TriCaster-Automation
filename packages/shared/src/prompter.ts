// What the prompter shows (Phase 3): every section that airs, in rundown order, as a list of lines. Each
// section starts with its number, who reads it and the camera to look at; cue chips become markers, and a
// speaker tag line like {JORDAN} becomes a speaker marker, with the cues at the top of that reader's part
// on the same line. Floated sections are skipped.
import * as Y from 'yjs';
import { breakCueId, isCrossTalk, type Element, type RundownTiming, type SectionRow } from './rundown.ts';
import { readScriptLines, scriptBody, speakerTagLine } from './script.ts';

/** A cue on the prompter: a graphic's, or a camera cue, where the switcher takes this camera (RG, Oct 30, 2026). */
export type PrompterCue = { kind: 'cue'; key: string; sectionId: string; element: Element } | { kind: 'camera'; key: string; sectionId: string; cueId: string; camera: string };

export type PrompterLine =
  | { kind: 'block'; key: string; label: string; title: string }
  | { kind: 'break'; key: string; seconds: number }
  | { kind: 'section'; key: string; sectionId: string; label: string; slug: string; readers: string[]; camera: string }
  | { kind: 'crossTalk'; key: string; sectionId: string }
  /** cues: the ones at the top of this reader's part, shown on the line with their name (RG, Nov 4, 2026). */
  | { kind: 'speaker'; key: string; sectionId: string; name: string; cues: PrompterCue[] }
  | { kind: 'text'; key: string; sectionId: string; text: string }
  | PrompterCue
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
    const script: PrompterLine[] = [];
    for (const { key, pieces } of body ? readScriptLines(body) : []) {
      const text = pieces.map((p) => (p.kind === 'text' ? p.text : '')).join('');
      pieces.forEach((p, i) => {
        if (p.kind === 'camera') script.push({ kind: 'camera', key: `${key}-${i}`, sectionId, cueId: cameraCueId(key, i), camera: p.camera });
        // A cue for a graphic removed from the rundown has nothing to fire, so it isn't shown.
        const element = p.kind === 'cue' ? elements.get(p.elementId) : undefined;
        if (element) script.push({ kind: 'cue', key: `${key}-${i}`, sectionId, element });
      });
      // No blank lines on the prompter, even ones the writer left in the script (RG, Nov 4, 2026).
      if (!text.trim()) continue;
      const speaker = speakerTagLine(text);
      script.push(speaker ? { kind: 'speaker', key, sectionId, name: speaker, cues: [] } : { kind: 'text', key, sectionId, text });
    }
    lines.push(...cuesOnSpeakerLines(script));
  }
  lines.push({ kind: 'end', key: 'end' });
  return lines;
}

const isCue = (line: PrompterLine): line is PrompterCue => line.kind === 'cue' || line.kind === 'camera';

/**
 * Moves the cues at the top of a reader's part onto the line with their name (RG, Nov 4, 2026): the cues
 * right after a speaker marker, and those above the first marker when no words come before them. Cues
 * among the words stay on their own lines.
 */
function cuesOnSpeakerLines(script: PrompterLine[]): PrompterLine[] {
  let lines: PrompterLine[] = [];
  let speaker: Extract<PrompterLine, { kind: 'speaker' }> | null = null;
  let waiting: PrompterCue[] = [];
  let wordsYet = false;
  for (const line of script) {
    if (line.kind === 'speaker') {
      // With only cues and empty lines before it, those cues come off their own lines and join it.
      const above = wordsYet ? [] : waiting;
      lines = lines.filter((l) => !above.includes(l as PrompterCue));
      speaker = { ...line, cues: [...above] };
      waiting = [];
      lines.push(speaker);
    } else if (isCue(line) && speaker) {
      speaker.cues.push(line);
    } else {
      if (isCue(line)) waiting.push(line);
      else {
        wordsYet = true;
        speaker = null;
      }
      lines.push(line);
    }
  }
  return lines;
}

/**
 * A camera cue's id, from where it sits in the script: it stays the same while the script is edited around
 * it, and a copy pasted elsewhere gets its own. The prompter sends it like a graphic's cue.
 */
export function cameraCueId(lineKey: string, index: number): string {
  return `camera-${lineKey}-${index}`;
}

export function isCameraCueId(id: string): boolean {
  return id.startsWith('camera-');
}

/** A section's camera cues, in script order. */
export function cameraCues(doc: Y.Doc, sectionId: string): { id: string; camera: string }[] {
  const body = scriptBody(doc, sectionId);
  return (body ? readScriptLines(body) : []).flatMap(({ key, pieces }) => pieces.flatMap((p, i) => (p.kind === 'camera' ? [{ id: cameraCueId(key, i), camera: p.camera }] : [])));
}

/**
 * The cues at the very top of a section's script, before any words to read (speaker tags and empty lines
 * don't count), in order: graphics by element id, and camera cues by cameraCueId. The show app fires them as the section starts, rather than once the section's
 * number, camera and talent lines have scrolled past, so back-to-back teases play one after another with
 * no camera between them (RG, Oct 29, 2026).
 */
export function topCues(doc: Y.Doc, sectionId: string): string[] {
  const body = scriptBody(doc, sectionId);
  const cues: string[] = [];
  for (const { key, pieces } of body ? readScriptLines(body) : []) {
    // The prompter shows a line's cues above its words.
    pieces.forEach((p, i) => {
      if (p.kind === 'cue') cues.push(p.elementId);
      else if (p.kind === 'camera') cues.push(cameraCueId(key, i));
    });
    const text = pieces.map((p) => (p.kind === 'text' ? p.text : '')).join('');
    if (text.trim() && !speakerTagLine(text)) break;
  }
  return cues;
}
