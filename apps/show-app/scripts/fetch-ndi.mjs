// Gets the NDI library RiGster ships with (RG, Nov 4, 2026), from NDI's own download of its SDK: the latest
// version, as NDI's license asks. Run by scripts/package.mjs. The SDK itself is never put in this repository
// or shared; only its library and notices go in RiGster, as NDI's SDK manual allows (its sections 3 and 4).
//
// Result, in .ndi-sdk/app: the library for this kind of computer, and NDI's notices (libndi_licenses.txt).
import { execFileSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.ndi-sdk');
const windows = process.platform === 'win32';
const url = windows ? 'https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20SDK.exe' : 'https://downloads.ndi.tv/SDK/NDI_SDK_Mac/Install_NDI_SDK_v6_Apple.pkg';
const library = windows ? 'Processing.NDI.Lib.x64.dll' : 'libndi.dylib';
const download = path.join(cache, windows ? 'sdk.exe' : 'sdk.pkg');
const stamp = path.join(cache, 'version.txt');

/** The first file with this name under a folder, skipping any folder named in `not`. */
function find(folder, name, not = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory() && !not.includes(entry.name)) {
      const inside = find(full, name, not);
      if (inside) return inside;
    }
  }
  return null;
}

export async function fetchNdi() {
  mkdirSync(cache, { recursive: true });
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`NDI's download answered ${head.status}: ${url}`);
  const version = head.headers.get('last-modified') ?? 'unknown';
  const app = path.join(cache, 'app');
  if (existsSync(path.join(app, library)) && existsSync(stamp) && readFileSync(stamp, 'utf8') === version) return app;

  const size = Number(head.headers.get('content-length') ?? 0);
  if (!existsSync(download) || statSync(download).size !== size || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    console.log(`Downloading NDI's SDK (${Math.round(size / 1e6)} MB)…`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`NDI's download answered ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(download));
  }

  const unpacked = path.join(cache, 'unpacked');
  rmSync(unpacked, { recursive: true, force: true });
  if (windows) execFileSync(download, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${unpacked}`], { stdio: 'inherit' });
  else execFileSync('pkgutil', ['--expand-full', download, unpacked], { stdio: 'inherit' });

  // On the Mac, the library for macOS, not the ones for iOS and the like.
  const from = windows ? find(unpacked, library) : find(unpacked, library, ['iOS', 'tvOS', 'visionOS', 'examples']);
  const notices = find(unpacked, 'libndi_licenses.txt') ?? find(unpacked, 'Processing.NDI.Lib.Licenses.txt');
  if (!from || !notices) throw new Error(`NDI's SDK didn't have ${from ? 'its notices' : library} where expected.`);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  cpSync(from, path.join(app, library));
  cpSync(notices, path.join(app, 'libndi_licenses.txt'));
  writeFileSync(stamp, version);
  return app;
}
