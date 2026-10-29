// Exporting a rundown as CSV (for spreadsheets) or PDF (for printing and sharing). Both are made in
// the browser, so they cost nothing on the server.
import { formatClock, formatDuration, formatOverUnder, type RundownTiming, type SectionRow } from '@tstv/shared';

export interface ExportInfo {
  showName: string;
  episodeTitle: string;
  airDate: string;
  airTime: string;
  defaultCamera: string;
}

const HEADERS = ['#', 'Slug', 'Type', 'Writer', 'Talent', 'Camera', 'Graphics', 'Notes', 'Floated', 'Est.', 'Back-time', 'Added by', 'Last edited by'];

function tableRows(timing: RundownTiming, info: ExportInfo): string[][] {
  const backTime = (offset: number | null) => (offset === null ? '' : info.airTime ? formatClock(info.airTime, offset) : `+${formatDuration(offset)}`);
  return timing.rows.map((c) => {
    if (c.row.kind === 'block') {
      return [c.label, `BLOCK ${c.label}${c.row.title ? `: ${c.row.title}` : ''}`, '', '', '', '', '', '', '', formatDuration(timing.blockSeconds[c.blockLetter] ?? 0), backTime(c.backTimeOffset), '', ''];
    }
    const s = c.row as SectionRow;
    return [
      c.label,
      s.slug,
      s.type,
      s.writer,
      s.talent,
      s.camera || info.defaultCamera,
      s.elements.map((e) => (e.name ? `${e.type} ${e.name}` : e.type)).join(', '),
      s.notes,
      s.floated ? 'Floated' : '',
      c.seconds > 0 || s.estSeconds !== null ? formatDuration(c.seconds) : '',
      backTime(c.backTimeOffset),
      s.createdBy?.name ?? '',
      s.updatedBy?.name ?? '',
    ];
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

export function toCsv(timing: RundownTiming, info: ExportInfo): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [HEADERS, ...tableRows(timing, info)].map((r) => r.map(quote).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function exportCsv(timing: RundownTiming, info: ExportInfo): void {
  // The byte-order mark makes Excel read accented names correctly.
  download(new Blob(['﻿', toCsv(timing, info)], { type: 'text/csv;charset=utf-8' }), fileName(info, 'csv'));
}

export async function exportPdf(timing: RundownTiming, info: ExportInfo): Promise<void> {
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
  autoTable(pdf, {
    startY: 72,
    head: [HEADERS],
    body: tableRows(timing, info),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [191, 87, 0] },
    didParseCell: (data) => {
      const label = String((data.row.raw as string[])[1] ?? '');
      if (data.section === 'body' && label.startsWith('BLOCK ')) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [238, 238, 238];
      }
    },
  });
  pdf.save(fileName(info, 'pdf'));
}
