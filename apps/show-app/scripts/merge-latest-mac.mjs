// Merges the two Macs' latest-mac.yml files into one (RG, Nov 10, 2026): the Apple-chip and Intel builds are
// made on separate machines, and each writes its own, but a release has one, which every Mac reads to
// update itself. RiGster on an Apple-chip Mac picks the files with "arm64" in their names; an Intel Mac
// the others. Run by .github/workflows/release.yml: node merge-latest-mac.mjs <apple-chip.yml> <intel.yml> <out.yml>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The lines of the yml's files list: each "  - url: …" entry with its sha512 and size. */
function fileEntries(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'files:');
  if (start < 0) throw new Error('No files list in latest-mac.yml');
  const end = lines.findIndex((l, i) => i > start && l.trim() !== '' && !l.startsWith(' '));
  return { lines, start, end: end < 0 ? lines.length : end };
}

/** The Apple-chip yml, with the Intel build's files added to its list. */
export function mergeLatestMac(appleChip, intel) {
  const a = fileEntries(appleChip);
  const b = fileEntries(intel);
  const added = b.lines.slice(b.start + 1, b.end).filter((l) => l.trim() !== '');
  return [...a.lines.slice(0, a.end), ...added, ...a.lines.slice(a.end)].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [appleChip, intel, out] = process.argv.slice(2);
  writeFileSync(out, mergeLatestMac(readFileSync(appleChip, 'utf8'), readFileSync(intel, 'utf8')));
}
