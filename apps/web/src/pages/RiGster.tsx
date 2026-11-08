// RiGster's download page (RG, Nov 8, 2026). Admins and contributors both see it. The links always point at the
// newest RiGster release on GitHub, which keeps a copy of each download under a name that never changes.
import { useEffect, useState } from 'react';

export const RIGSTER_REPO = 'rg-sureshkumar-goat/TSTV-TriCaster-Automation';
const latest = `https://github.com/${RIGSTER_REPO}/releases/latest/download`;

export const RIGSTER_DOWNLOADS = [
  { label: 'Mac with an Apple chip', detail: 'M1 or newer', file: 'RiGster-Mac-Apple-chip.dmg' },
  { label: 'Mac with an Intel chip', detail: 'Older Macs', file: 'RiGster-Mac-Intel.dmg' },
  { label: 'Windows', detail: 'Windows 10 or 11, 64-bit', file: 'RiGster-Windows-Setup.exe' },
] as const;

type Release = { state: 'loading' } | { state: 'none' } | { state: 'ready'; version: string; date: string } | { state: 'unknown' };

export function RiGsterPage() {
  const [release, setRelease] = useState<Release>({ state: 'loading' });
  useEffect(() => {
    // Which version the links give. Only for the label: the links work without it.
    fetch(`https://api.github.com/repos/${RIGSTER_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(async (r) => {
        if (r.status === 404) return setRelease({ state: 'none' });
        if (!r.ok) return setRelease({ state: 'unknown' });
        const d = (await r.json()) as { tag_name: string; published_at: string };
        setRelease({ state: 'ready', version: d.tag_name.replace(/^v/, ''), date: new Date(d.published_at).toLocaleDateString(undefined, { dateStyle: 'long' }) });
      })
      .catch(() => setRelease({ state: 'unknown' }));
  }, []);
  const none = release.state === 'none';

  return (
    <div className="page rigster">
      <h1>RiGster</h1>
      <p className="muted">
        TSTV’s show app: it plays the graphics, green screen and transitions into the TriCaster, follows the rundown, and records the show.
      </p>
      <p className="rigster-version" role="status">
        {release.state === 'loading' && 'Checking the newest version…'}
        {release.state === 'ready' && `Version ${release.version}, released ${release.date}.`}
        {none && 'The first version of RiGster hasn’t been released yet. These links will work once it is.'}
        {release.state === 'unknown' && 'The newest version.'}
      </p>

      <ul className="rigster-downloads">
        {RIGSTER_DOWNLOADS.map((d) => (
          <li key={d.file}>
            <a className="button primary" href={none ? undefined : `${latest}/${d.file}`} aria-disabled={none || undefined} aria-label={`Download RiGster for ${d.label}`}>
              <strong>{d.label}</strong>
              <span>{d.detail}</span>
            </a>
          </li>
        ))}
      </ul>

      <h2>Which Mac do I have?</h2>
      <p>
        Click the Apple menu in the top left corner, then <strong>About This Mac</strong>. If it says <strong>Chip: Apple M…</strong>, get
        the Apple chip version. If it says <strong>Processor: …Intel…</strong>, get the Intel version.
      </p>

      <h2>Installing</h2>
      <ul>
        <li>
          <strong>Mac:</strong> open the .dmg, agree to the license, and drag RiGster into Applications. The first time you open it, your Mac asks
          if you’re sure, because it came from the Internet. Click <strong>Open</strong>.
        </li>
        <li>
          <strong>Windows:</strong> run the Setup file and agree to the license. If Windows says it protected your PC, click{' '}
          <strong>More info</strong>, then <strong>Run anyway</strong>.
        </li>
      </ul>

      <h2>Notices</h2>
      <p className="muted small">
        RiGster uses NDI® to send video to the TriCaster. NDI® is a registered trademark of Vizrt NDI AB. RiGster isn’t a product of Vizrt
        NDI AB. Learn about NDI at <a href="https://ndi.video/">ndi.video</a>.
      </p>
      <p className="muted small">
        RiGster includes FFmpeg (<a href="https://ffmpeg.org/">ffmpeg.org</a>), licensed under the{' '}
        <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU General Public License, version 3</a>. Its notice, with where to get its source
        code, is in the legal folder that comes with RiGster.
      </p>
    </div>
  );
}
