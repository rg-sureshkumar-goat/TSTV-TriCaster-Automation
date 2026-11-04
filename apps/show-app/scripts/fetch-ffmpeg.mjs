// Gets the FFmpeg RiGster ships with (RG, Nov 4, 2026). ffmpeg-static's own build, used when running from the
// source, has --enable-nonfree, which can't be shared; these are exact builds without it, checked by their
// SHA-256 so what ships is what was tested. To update one, change its address and checksum, and test it.
//
// Result, in .ffmpeg/<computer>: ffmpeg (or ffmpeg.exe).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUILDS = {
  // https://ffmpeg.martin-riedl.de (FFmpeg 9.0.2)
  'darwin-arm64': { url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip', sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924' },
  'darwin-x64': { url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip', sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4' },
  // https://github.com/BtbN/FFmpeg-Builds (FFmpeg 9.0.2, kept for two years)
  'win32-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-9.0.zip',
    sha256: '693f3e224bc184b40524a62ca47526cfebaf2504414021b92fe75f677ad868b9',
  },
};

function find(folder, name) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const inside = find(full, name);
      if (inside) return inside;
    }
  }
  return null;
}

/** The path to FFmpeg for this kind of computer, downloading it if it isn't here yet. */
export async function fetchFfmpeg(arch) {
  const key = `${process.platform}-${arch}`;
  const build = BUILDS[key];
  if (!build) throw new Error(`No FFmpeg build is set for ${key}.`);
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const folder = path.join(root, '.ffmpeg', key);
  const zip = path.join(folder, 'ffmpeg.zip');
  const sum = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  mkdirSync(folder, { recursive: true });
  if (!existsSync(zip) || sum(zip) !== build.sha256) {
    console.log(`Downloading FFmpeg for ${key}…`);
    const response = await fetch(build.url);
    if (!response.ok || !response.body) throw new Error(`FFmpeg's download answered ${response.status}: ${build.url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
    if (sum(zip) !== build.sha256) throw new Error(`FFmpeg's download for ${key} isn't the build that was tested.`);
  }
  const unpacked = path.join(folder, 'unpacked');
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked);
  // tar reads zip files on Windows 10 and later.
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', unpacked], { stdio: 'inherit' });
  else execFileSync('unzip', ['-q', zip, '-d', unpacked], { stdio: 'inherit' });
  const file = find(unpacked, name);
  if (!file) throw new Error(`FFmpeg's download for ${key} didn't have ${name}.`);
  return { file, source: build.url };
}
