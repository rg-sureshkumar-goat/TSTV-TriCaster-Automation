// What the show app remembers on this laptop, in its own folder: the website address and last key, the
// simulator's address, each show's music cue points and permanent graphics, and each episode's files.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileInfo } from './media.ts';

export interface Settings {
  siteUrl: string;
  key: string;
  simulatorAddress: string;
  /** Each show's music in and out points ("default", "none", "section:<id>" or "cue:<id>"), by show id. */
  music: Record<string, { in: string; out: string }>;
}

export const DEFAULT_SETTINGS: Settings = {
  siteUrl: 'https://tstv-show.tstv-rundown.workers.dev',
  key: '',
  simulatorAddress: '127.0.0.1:8080',
  music: {},
};

export class Store {
  constructor(private folder: string) {}

  private async read<T>(name: string, fallback: T): Promise<T> {
    try {
      return { ...fallback, ...(JSON.parse(await readFile(path.join(this.folder, name), 'utf8')) as T) };
    } catch {
      return fallback;
    }
  }

  private async write(name: string, value: unknown): Promise<void> {
    const file = path.join(this.folder, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 1));
  }

  settings(): Promise<Settings> {
    return this.read('settings.json', DEFAULT_SETTINGS);
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.write('settings.json', settings);
  }

  /** An episode's files, by element id. */
  episodeFiles(episodeId: string): Promise<Record<string, FileInfo>> {
    return this.read(`episodes/${episodeId}.json`, {});
  }

  saveEpisodeFiles(episodeId: string, files: Record<string, FileInfo>): Promise<void> {
    return this.write(`episodes/${episodeId}.json`, files);
  }

  /** A show's permanent graphics' files, by graphic name, reused for every episode. */
  permanentFiles(showId: string): Promise<Record<string, FileInfo>> {
    return this.read(`shows/${showId}.json`, {});
  }

  savePermanentFiles(showId: string, files: Record<string, FileInfo>): Promise<void> {
    return this.write(`shows/${showId}.json`, files);
  }

  /** A show's green-screen background (one for the whole show). */
  async greenScreen(showId: string): Promise<FileInfo | null> {
    return (await this.read<{ file: FileInfo | null }>(`green-screen/${showId}.json`, { file: null })).file;
  }

  saveGreenScreen(showId: string, file: FileInfo | null): Promise<void> {
    return this.write(`green-screen/${showId}.json`, { file });
  }
}
