// @ts-check
// The probe's one safety rule lives here: it may only READ from the TriCaster.
// Every web request and every byte the probe sends to the TC1 passes through these checks,
// so a mistake anywhere else in the probe fails loudly instead of changing the switcher.

/** Web addresses the probe may read, always with GET. Nothing else is allowed. */
export const ALLOWED_HTTP_PATHS = Object.freeze(['/', '/v1', '/v1/', '/v1/version', '/v1/datalink', '/v1/dictionary']);

/** The only live-update address the probe may open. */
export const ALLOWED_WS_PATHS = Object.freeze(['/v1/change_notifications']);

/** "Send me state updates." The only message the probe sends on the state port (5951). */
export const REGISTER_MESSAGE = '<register name="NTK_states"/>\n';

/** An empty line that keeps the state-port connection open, as node-tricaster does. */
export const KEEPALIVE_MESSAGE = '\n';

/** Keeps the change-notification connection open; Bitfocus Companion sends the same text. */
export const WS_KEEPALIVE_MESSAGE = 'keep alive';

const DICTIONARY_KEY = /^[A-Za-z0-9_]{1,64}$/;

export class ReadOnlyViolation extends Error {
  /** @param {string} message */
  constructor(message) {
    super(`${message} The probe only reads from the TriCaster.`);
    this.name = 'ReadOnlyViolation';
  }
}

/**
 * Throws unless this is a GET to an allowed read-only address.
 * @param {string} method
 * @param {string} path path plus query, for example "/v1/dictionary?key=tally"
 */
export function assertReadOnlyHttp(method, path) {
  if (method !== 'GET') throw new ReadOnlyViolation(`Blocked a ${method} request to ${path}.`);
  const url = new URL(path, 'http://tc1.invalid');
  if (!ALLOWED_HTTP_PATHS.includes(url.pathname)) {
    throw new ReadOnlyViolation(`Blocked a request to ${url.pathname}, which is not on the read-only list.`);
  }
  const params = [...url.searchParams.keys()];
  if (url.pathname === '/v1/dictionary') {
    const key = url.searchParams.get('key') ?? '';
    if (params.length !== 1 || params[0] !== 'key' || !DICTIONARY_KEY.test(key)) {
      throw new ReadOnlyViolation(`Blocked a dictionary request with unexpected parameters: ${path}.`);
    }
  } else if (params.length > 0) {
    throw new ReadOnlyViolation(`Blocked a request with parameters: ${path}.`);
  }
}

/** @param {string} path */
export function assertReadOnlyWsPath(path) {
  if (!ALLOWED_WS_PATHS.includes(path)) throw new ReadOnlyViolation(`Blocked a live connection to ${path}.`);
}

/** @param {string} message */
export function assertReadOnlyStatePortMessage(message) {
  if (message !== REGISTER_MESSAGE && message !== KEEPALIVE_MESSAGE) {
    throw new ReadOnlyViolation(`Blocked a state-port message: ${JSON.stringify(message)}.`);
  }
}

/** @param {string} message */
export function assertReadOnlyWsMessage(message) {
  if (message !== WS_KEEPALIVE_MESSAGE) {
    throw new ReadOnlyViolation(`Blocked a live-connection message: ${JSON.stringify(message)}.`);
  }
}
