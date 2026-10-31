// Packages RiGster as an installable app (Phase 6): a .dmg for the Mac, or a Setup .exe for Windows, for
// the computer it runs on. Run with `npm run package -w apps/show-app`; the installer lands in
// apps/show-app/release/out. On GitHub, .github/workflows/release.yml runs it on a Mac and on Windows.
//
// 1. Builds the producer screen (Vite), and bundles the rest of the app's code (esbuild) into
//    dist/main, so it runs without the terminal.
// 2. Puts together the app's folder in release/app: the bundles, the screen, FFmpeg in bin, and koffi
//    (which calls NDI) for this computer only.
// 3. Asks electron-builder to make the installer from that folder.
//
// Options: --dir makes just the app, without the installer (quicker, for trying it); --arch=x64 or
// --arch=arm64 makes it for that kind of computer (default: this one's; FFmpeg must be that kind too).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build as makeInstaller } from 'electron-builder';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const app = path.join(release, 'app');
const own = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = require('electron/package.json').version;
const onlyTheApp = process.argv.includes('--dir');
const arch = process.argv.find((a) => a.startsWith('--arch='))?.slice('--arch='.length) ?? process.arch;
const windows = process.platform === 'win32';

rmSync(release, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// 1. The screen, then the rest of the app.
execFileSync(windows ? 'npx.cmd' : 'npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', shell: windows });
await bundle({
  entryPoints: {
    main: path.join(root, 'src/main/main.ts'),
    'playout-worker': path.join(root, 'src/main/playout-worker.ts'),
    'feeds-worker': path.join(root, 'src/main/feeds-worker.ts'),
  },
  outdir: path.join(app, 'dist/main'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Electron comes with the app; koffi is copied in whole (it loads its own compiled part); ws's two
  // optional speed-ups aren't installed.
  external: ['electron', 'koffi', 'bufferutil', 'utf-8-validate'],
  define: { BUNDLED: 'true' },
  // Some of the bundled packages are older-style modules that call require.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});

// 2. The app's folder.
cpSync(path.join(root, 'dist/renderer'), path.join(app, 'dist/renderer'), { recursive: true });
cpSync(path.join(root, 'preload.cjs'), path.join(app, 'preload.cjs'));
mkdirSync(path.join(app, 'bin'));
cpSync(require('ffmpeg-static'), path.join(app, 'bin', windows ? 'ffmpeg.exe' : 'ffmpeg'));
const koffi = path.dirname(require.resolve('koffi/package.json'));
const koffiBuild = `${process.platform}_${arch}`;
cpSync(koffi, path.join(app, 'node_modules/koffi'), {
  recursive: true,
  // Only this computer's compiled part, and no source code.
  filter: (from) => {
    const inside = path.relative(koffi, from).split(path.sep);
    if (inside[0] === 'src' || inside[0] === 'doc') return false;
    return !(inside[0] === 'build' && inside[1] === 'koffi' && inside[2] && inside[2] !== koffiBuild);
  },
});
const { version: koffiVersion } = require('koffi/package.json');
writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'rigster',
      productName: 'RiGster',
      version: own.version,
      description: 'Runs TSTV’s TriCaster from the rundown and the prompter',
      author: 'Texas Student Television',
      type: 'module',
      main: 'dist/main/main.mjs',
      dependencies: { koffi: koffiVersion },
    },
    null,
    2,
  ),
);

// 3. The installer.
// Publishing is done by .github/workflows/release.yml, once the Mac and Windows installers are all made.
await makeInstaller({
  publish: 'never',
  config: {
    appId: 'org.tstv.rigster',
    productName: 'RiGster',
    copyright: 'Texas Student Television',
    electronVersion,
    asar: false,
    npmRebuild: false,
    directories: { app, output: path.join(release, 'out'), buildResources: path.join(root, 'assets') },
    icon: path.join(root, 'assets/icon.png'),
    artifactName: 'RiGster-${version}-${os}-${arch}.${ext}',
    // Free, so not signed with a paid certificate (RG, Oct 30, 2026): the Mac app is signed only by this
    // computer, so macOS asks once before it opens; Windows says "Windows protected your PC" until you
    // click More info, then Run anyway.
    // The app loads NDI's library from NDI Tools, so macOS's stricter "hardened runtime" (which only
    // allows libraries signed by the app's own developer) stays off.
    mac: { target: [{ target: onlyTheApp ? 'dir' : 'dmg', arch: [arch] }], category: 'public.app-category.video', identity: '-', hardenedRuntime: false },
    dmg: { title: 'RiGster ${version}' },
    win: { target: [{ target: onlyTheApp ? 'dir' : 'nsis', arch: [arch] }] },
    nsis: { artifactName: 'RiGster-Setup-${version}.${ext}', oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false, shortcutName: 'RiGster' },
    // Where updates come from: this repository's GitHub Releases (the app also says so itself, in updates.ts).
    publish: [{ provider: 'github', owner: 'rg-sureshkumar-goat', repo: 'TSTV-TriCaster-Automation', releaseType: 'release' }],
  },
});
console.log(`\nRiGster ${own.version} is in ${path.join(release, 'out')}`);
