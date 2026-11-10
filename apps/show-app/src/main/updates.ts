// New versions of RiGster (Phase 6), from the repository's GitHub Releases. RiGster downloads the new
// version by itself, and installs it when the producer clicks Update (RiGster closes, installs it and opens
// again), or when it's next closed. On Windows from the start; on Macs since RiGster is signed with TSTV's
// Developer ID and approved by Apple, which macOS needs for an app to replace itself (RG, Nov 10, 2026: no
// more download page). A Mac copy that can't update itself (one built on a laptop, signed only by it) falls
// back to the download page.
// It checks when it opens and every few hours, and only in the installed app.
import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';

export type UpdateState = { status: 'available' | 'downloading' | 'ready'; version: string } | null;

const DOWNLOAD_PAGE = 'https://github.com/rg-sureshkumar-goat/TSTV-TriCaster-Automation/releases/latest';
const EVERY = 4 * 60 * 60 * 1000;

export function watchForUpdates(onChange: (state: UpdateState) => void): { apply: () => void } {
  const { autoUpdater } = electronUpdater;
  if (!app.isPackaged) return { apply: () => undefined };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  // The repository's GitHub Releases; or, for testing the checks, a pretend release on this computer.
  autoUpdater.setFeedURL(
    process.env.RIGSTER_UPDATE_URL
      ? { provider: 'generic', url: process.env.RIGSTER_UPDATE_URL }
      : { provider: 'github', owner: 'rg-sureshkumar-goat', repo: 'TSTV-TriCaster-Automation', releaseType: 'release' },
  );
  // The version being downloaded or installed; and whether this Mac has to get it from the download page.
  let version: string | null = null;
  let byHand = false;
  autoUpdater.on('update-available', (info) => {
    version = info.version;
    onChange({ status: byHand ? 'available' : 'downloading', version });
  });
  autoUpdater.on('update-downloaded', (info) => onChange({ status: 'ready', version: info.version }));
  autoUpdater.on('error', () => {
    // A Mac that can't replace RiGster itself (not signed by TSTV): the button opens the download page.
    // Otherwise it's no internet, or GitHub down: it tries again next time.
    if (process.platform === 'darwin' && version) {
      byHand = true;
      onChange({ status: 'available', version });
    }
  });
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, EVERY).unref();
  return {
    apply: () => {
      if (byHand) void shell.openExternal(DOWNLOAD_PAGE);
      else autoUpdater.quitAndInstall();
    },
  };
}
