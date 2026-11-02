// Exporting a rundown as CSV (for spreadsheets) or PDF (for printing and sharing). Both are made in
// the browser, so they cost nothing on the server. They have the rundown's own columns, in its order
// (RG, Nov 2, 2026: the ones its template chose), after the block or section number.
import { DEFAULT_COLUMNS, elementLabel, formatClock, talentLabel, formatDuration, formatOverUnder, RUNDOWN_COLUMNS, type ColumnKey, type RundownTiming, type SectionRow } from '@tstv/shared';

export interface ExportInfo {
  showName: string;
  episodeTitle: string;
  airDate: string;
  airTime: string;
  defaultCamera: string;
  /** The permanent graphic that plays during commercial breaks. */
  breakGraphic?: string;
  anchors?: string[];
  correspondents?: string[];
}

/** The headings: the number, then the rundown's columns, named as in the rundown. */
function headers(columns: ColumnKey[]): string[] {
  return ['#', ...columns.map((key) => RUNDOWN_COLUMNS.find((c) => c.key === key)!.label)];
}

type Line = { kind: 'block' | 'break' | 'section'; cells: string[] };

/** One line per block, commercial break and section, with a cell for each of the rundown's columns. */
function tableRows(timing: RundownTiming, info: ExportInfo, columns: ColumnKey[]): Line[] {
  const backTime = (offset: number | null) => (offset === null ? '' : info.airTime ? formatClock(info.airTime, offset) : `+${formatDuration(offset)}`);
  const line = (kind: Line['kind'], number: string, values: Partial<Record<ColumnKey, string>>): Line => ({ kind, cells: [number, ...columns.map((key) => values[key] ?? '')] });
  return timing.rows.flatMap((c) => {
    const lines: Line[] = [];
    if (c.breakBefore) {
      const b = c.breakBefore;
      lines.push(line('break', '', { slug: 'COMMERCIAL BREAK', graphics: info.breakGraphic ?? '', est: b.seconds > 0 ? formatDuration(b.seconds) : '', backTime: b.seconds > 0 ? backTime(b.backTimeOffset) : '' }));
    }
    if (c.row.kind === 'block') {
      lines.push(line('block', c.label, { slug: `BLOCK ${c.label}${c.row.title ? `: ${c.row.title}` : ''}`, est: formatDuration(timing.blockSeconds[c.blockLetter] ?? 0), backTime: backTime(c.backTimeOffset) }));
      return lines;
    }
    const s = c.row as SectionRow;
    lines.push(
      line('section', s.floated ? `${c.label} (floated)` : c.label, {
        slug: s.slug,
        type: s.type,
        writer: s.writer,
        talent: talentLabel(s.talent),
        camera: s.camera || info.defaultCamera,
        headline: s.headline,
        graphics: s.elements.map(elementLabel).join(', '),
        notes: s.notes,
        assignGraphics: s.assignGraphics,
        est: c.seconds > 0 || s.estSeconds !== null ? formatDuration(c.seconds) : '',
        backTime: backTime(c.backTimeOffset),
        lastEdit: s.updatedBy?.name ?? '',
      }),
    );
    return lines;
  });
}

function fileName(info: ExportInfo, extension: string): string {
  return `${info.showName} - ${info.episodeTitle} rundown.${extension}`.replace(/[\\/:*?"<>|]+/g, '-');
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(timing: RundownTiming, info: ExportInfo, columns: ColumnKey[] = DEFAULT_COLUMNS): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers(columns), ...tableRows(timing, info, columns).map((l) => l.cells)].map((r) => r.map(quote).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function exportCsv(timing: RundownTiming, info: ExportInfo, columns: ColumnKey[] = DEFAULT_COLUMNS): void {
  // The byte-order mark makes Excel read accented names correctly.
  download(new Blob(['﻿', toCsv(timing, info, columns)], { type: 'text/csv;charset=utf-8' }), fileName(info, 'csv'));
}

export async function exportPdf(timing: RundownTiming, info: ExportInfo, columns: ColumnKey[] = DEFAULT_COLUMNS): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  pdf.setFontSize(16);
  pdf.text(`${info.showName}: ${info.episodeTitle}`, 40, 40);
  pdf.setFontSize(10);
  const when = [info.airDate, info.airTime && formatClock(info.airTime, 0)].filter(Boolean).join(' at ');
  pdf.text(
    `${when ? `${when}   ·   ` : ''}Total ${formatDuration(timing.totalSeconds)} of ${formatDuration(timing.targetSeconds)} (${formatOverUnder(timing.overUnderSeconds)})`,
    40,
    58,
  );
  const talentLine = [
    info.anchors?.length ? `Anchors: ${info.anchors.join(', ')}` : '',
    info.correspondents?.length ? `Correspondents: ${info.correspondents.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('   ·   ');
  if (talentLine) pdf.text(talentLine, 40, 72);
  const lines = tableRows(timing, info, columns);
  autoTable(pdf, {
    startY: talentLine ? 86 : 72,
    head: [headers(columns)],
    body: lines.map((l) => l.cells),
    styles: { fontSize: 8, cellPadding: 3 },
    // The website's blue (#14679b).
    headStyles: { fillColor: [20, 103, 155] },
    didParseCell: (data) => {
      const kind = data.section === 'body' ? lines[data.row.index]?.kind : undefined;
      if (kind === 'block') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [238, 238, 238];
      }
      if (kind === 'break') {
        data.cell.styles.fontStyle = 'italic';
        data.cell.styles.fillColor = [246, 246, 246];
      }
    },
  });
  pdf.save(fileName(info, 'pdf'));
}
