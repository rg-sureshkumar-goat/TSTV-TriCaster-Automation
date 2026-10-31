// New versions of RiGster (Phase 6), from the repository's GitHub Releases. Staying free (RG, Oct 30,
// 2026) means the app isn't signed with a paid certificate, so:
// - Windows: RiGster downloads the new version by itself, and installs it when it's next closed (or
//   when the producer clicks Restart to update).
// - Mac: macOS won't let an unsigned app replace itself, so RiGster says a new version is out, and its
//   button opens the download page.
// It checks when it opens and every few hours, and only in the installed app.
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';

export type UpdateState = { status: 'available' | 'downloading' | 'ready'; version: string } | null;

const DOWNLOAD_PAGE = 'https://github.com/rg-sureshkumar-goat/TSTV-TriCaster-Automation/releases/latest';
const EVERY = 4 * 60 * 60 * 1000;

export function watchForUpdates(onChange: (state: UpdateState) => void): { apply: () => void } {
  const { autoUpdater } = electronUpdater;
  const installsItself = process.platform === 'win32';
  if (!app.isPackaged) return { apply: () => undefined };
  autoUpdater.autoDownload = installsItself;
  autoUpdater.autoInstallOnAppQuit = installsItself;
  autoUpdater.logger = null;
  // The repository's GitHub Releases; or, for testing the checks, a pretend release on this computer.
  autoUpdater.setFeedURL(
    process.env.RIGSTER_UPDATE_URL
      ? { provider: 'generic', url: process.env.RIGSTER_UPDATE_URL }
      : { provider: 'github', owner: 'rg-sureshkumar-goat', repo: 'TSTV-TriCaster-Automation', releaseType: 'release' },
  );
  autoUpdater.on('update-available', (info) => onChange({ status: installsItself ? 'downloading' : 'available', version: info.version }));
  autoUpdater.on('update-downloaded', (info) => onChange({ status: 'ready', version: info.version }));
  // No internet, or GitHub down: try again next time.
  autoUpdater.on('error', () => undefined);
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, EVERY).unref();
  return {
    apply: () => {
      if (installsItself) autoUpdater.quitAndInstall();
      else void shell.openExternal(DOWNLOAD_PAGE);
    },
  };
}
