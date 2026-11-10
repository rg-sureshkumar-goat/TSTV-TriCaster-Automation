// The release's one latest-mac.yml lists both Macs' builds, so every Mac can update itself (RG, Nov 10, 2026).
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript script, run by the release workflow.
import { mergeLatestMac } from '../scripts/merge-latest-mac.mjs';

const yml = (arch: string) => `version: 1.0.2
files:
  - url: RiGster-1.0.2-mac-${arch}.zip
    sha512: zip${arch}==
    size: 100
  - url: RiGster-1.0.2-mac-${arch}.dmg
    sha512: dmg${arch}==
    size: 200
path: RiGster-1.0.2-mac-${arch}.zip
sha512: zip${arch}==
releaseDate: '2026-11-10T22:00:00.000Z'
`;

describe('merging the Macs’ update files', () => {
  it('lists the Apple-chip and Intel builds together, keeping the rest of the Apple-chip one', () => {
    const merged: string = mergeLatestMac(yml('arm64'), yml('x64'));
    expect(merged.match(/- url: (\S+)/g)).toEqual(['- url: RiGster-1.0.2-mac-arm64.zip', '- url: RiGster-1.0.2-mac-arm64.dmg', '- url: RiGster-1.0.2-mac-x64.zip', '- url: RiGster-1.0.2-mac-x64.dmg']);
    expect(merged).toContain('    sha512: zipx64==\n    size: 100\n');
    expect(merged).toMatch(/^version: 1\.0\.2\n/);
    expect(merged).toContain('path: RiGster-1.0.2-mac-arm64.zip\nsha512: ziparm64==\nreleaseDate:');
  });
});
