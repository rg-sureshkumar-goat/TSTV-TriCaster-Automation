// RiGster's show log (RG, Nov 17, 2026): everything that happens during a show, with the time to the
// millisecond, kept in a file per day on this laptop, so a problem seen at a show (like every second
// tease not reaching Program) can be traced afterwards: the prompter's cues, the commands sent to the TC1
// and the playout, what the TC1 and the playout report back, and the Status box's notes. Files older
// than 30 days are deleted.
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const KEEP_DAYS = 30;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A date as YYYY-MM-DD, on this laptop's clock. */
export function logDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A time as 18:30:15.123, on this laptop's clock. */
export function logTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export class ShowLog {
  /** Lines are written one after another, in order, without holding anything up. */
  private writing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(readonly folder: string) {
    void this.prune();
  }

  /** The file for a day: show-YYYY-MM-DD.log. */
  fileFor(date = new Date()): string {
    return path.join(this.folder, `show-${logDay(date)}.log`);
  }

  write(text: string): void {
    if (this.closed) return;
    const now = new Date();
    const line = `${logTime(now)}  ${text.replace(/\n/g, ' ')}\n`;
    const file = this.fileFor(now);
    this.writing = this.writing
      .then(() => mkdir(this.folder, { recursive: true }))
      .then(() => appendFile(file, line))
      .catch(() => undefined);
  }

  /** The last line, as RiGster closes; nothing is written after it. Resolves once it's all in the file. */
  close(text = 'RiGster closed'): Promise<void> {
    this.write(text);
    this.closed = true;
    return this.writing;
  }

  /** Resolves once everything written so far is in the file. */
  flushed(): Promise<void> {
    return this.writing;
  }

  private async prune(): Promise<void> {
    const oldest = logDay(new Date(Date.now() - KEEP_DAYS * 24 * 3600_000));
    const files = await readdir(this.folder).catch(() => [] as string[]);
    for (const f of files) {
      const day = /^show-(\d{4}-\d{2}-\d{2})\.log$/.exec(f)?.[1];
      if (day && day < oldest) await rm(path.join(this.folder, f), { force: true });
    }
  }
}
