// @ts-check
// Questions typed in the terminal. Kept apart so tests can run the probe without a keyboard.
import readline from 'node:readline/promises';

/**
 * @param {string} question
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
export async function ask(question, signal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question, { signal })).trim();
  } catch {
    return '';
  } finally {
    rl.close();
  }
}

/**
 * Reads a password without showing it on screen. Returns '' if the person just presses Enter.
 * @param {string} question
 * @returns {Promise<string>}
 */
export function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (/** @type {string} */ chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done();
          return;
        }
        if (ch === '\u0003') {
          value = '';
          done();
          process.kill(process.pid, 'SIGINT');
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += ch;
        process.stdout.write('*');
      }
    };
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    stdin.on('data', onData);
  });
}
