// Converting L3, OTSL and OTSR graphics on GitHub's free machines (RG, Nov 17, 2026). The browser reads a
// graphic's format before it's uploaded (see readVideoFormat); one that isn't 1080p, 29.97, ProRes 4444 with
// alpha in a QuickTime .mov is uploaded as it is, and then the website starts the repository's
// convert-graphic workflow with a job id. The GitHub machine asks for the job (the file, its folder and an
// hour's access to the Drive), converts it, sends the copy to the same folder, and reports back; the copy
// then goes on the graphic, and the original is deleted for good. See tools/converter.
import type { Hono } from 'hono';
import { randomToken } from './auth.ts';
import { accessToken, deleteForever, DriveError, fileInfo, shareByLink } from './drive.ts';
import { driveLink, episodeFolder, googleClient, openDrive } from './drive-layout.ts';
import type { Env, User } from './env.ts';

type App = Hono<{ Bindings: Env; Variables: { user: User } }>;

const REPOSITORY = 'rg-sureshkumar-goat/TSTV-TriCaster-Automation';
const WORKFLOW = 'convert-graphic.yml';
/** A conversion that hasn't reported back after this long is taken to have failed. */
export const CONVERSION_TIMEOUT_MS = 30 * 60_000;

/** Asks GitHub to run the converter for a job. Throws with a plain reason when it can't. */
export async function startWorkflow(env: Env, jobId: string, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!env.GITHUB_TOKEN || !env.CONVERTER_SECRET) throw new Error('The graphic converter isn’t set up on the website yet.');
  const response = await fetchFn(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tstv-rundowns',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { job: jobId } }),
  });
  if (response.status !== 204) throw new Error(`GitHub didn’t start the converter (${response.status}).`);
}

/**
 * Starts converting the file now on an episode's graphic. If GitHub can't start it, the graphic keeps its
 * original and says why.
 */
export async function convertGraphic(env: Env, episodeId: string, elementId: string, driveFileId: string): Promise<void> {
  const jobId = randomToken();
  await env.DB.prepare('DELETE FROM graphic_conversions WHERE episode_id = ? AND element_id = ?').bind(episodeId, elementId).run();
  await env.DB.prepare('INSERT INTO graphic_conversions (job_id, episode_id, element_id, drive_file_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(jobId, episodeId, elementId, driveFileId, Date.now())
    .run();
  await env.DB.prepare('UPDATE episode_graphics SET convert_error = NULL, fixes = NULL WHERE episode_id = ? AND element_id = ?').bind(episodeId, elementId).run();
  try {
    await startWorkflow(env, jobId);
  } catch (e) {
    await finish(env, jobId, e instanceof Error ? e.message : String(e));
  }
}

/** Ends a job: with an error, it's noted on the graphic (which keeps its original). */
async function finish(env: Env, jobId: string, error?: string): Promise<void> {
  const job = await env.DB.prepare('SELECT episode_id, element_id, drive_file_id FROM graphic_conversions WHERE job_id = ?').bind(jobId).first<{ episode_id: string; element_id: string; drive_file_id: string }>();
  await env.DB.prepare('DELETE FROM graphic_conversions WHERE job_id = ?').bind(jobId).run();
  if (job && error) {
    await env.DB.prepare('UPDATE episode_graphics SET convert_error = ? WHERE episode_id = ? AND element_id = ? AND drive_file_id = ?')
      .bind(error.slice(0, 300), job.episode_id, job.element_id, job.drive_file_id)
      .run();
  }
}

const sameSecret = (a: string | undefined, b: string | undefined) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** The routes the GitHub machine uses. It shows the converter secret, not a sign-in. */
export function registerConversionRoutes(app: App): void {
  app.use('/converter/*', async (c, next) => {
    if (!sameSecret(c.req.header('X-Converter-Secret'), c.env.CONVERTER_SECRET)) return c.json({ error: 'Wrong converter secret.' }, 401);
    await next();
  });

  /** The job: the original file, the episode's folder, and an hour's access to the Drive. */
  app.get('/converter/jobs/:job', async (c) => {
    const job = await c.env.DB.prepare(
      `SELECT j.*, g.file_name FROM graphic_conversions j JOIN episode_graphics g ON g.episode_id = j.episode_id AND g.element_id = j.element_id AND g.drive_file_id = j.drive_file_id WHERE j.job_id = ?`,
    )
      .bind(c.req.param('job'))
      .first<{ episode_id: string; element_id: string; drive_file_id: string; file_name: string }>();
    if (!job) return c.json({ error: 'That conversion isn’t needed any more (the graphic changed, or it was taken off).' }, 404);
    try {
      const open = await openDrive(c.env);
      if (!open) return c.json({ error: 'No Google Drive is connected.' }, 409);
      const folderId = await episodeFolder(c.env, open.token, open.drive, job.episode_id);
      return c.json({ fileName: job.file_name, driveFileId: job.drive_file_id, folderId, accessToken: open.token });
    } catch (e) {
      return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
    }
  });

  /**
   * The converter's report: the converted copy (which then replaces the original), unchanged (it was right
   * after all), or an error.
   */
  app.post('/converter/jobs/:job/done', async (c) => {
    const jobId = c.req.param('job');
    const body = await c.req.json<{ driveFileId?: string; fixes?: string[]; unchanged?: boolean; error?: string }>().catch(() => ({}) as Record<string, never>);
    const job = await c.env.DB.prepare('SELECT * FROM graphic_conversions WHERE job_id = ?').bind(jobId).first<{ episode_id: string; element_id: string; drive_file_id: string }>();
    if (!job) {
      // The graphic changed while it was converting: the copy isn't wanted.
      if (body.driveFileId) {
        const drive = await driveLink(c.env);
        if (drive) await deleteForever((await accessToken(drive.refresh_token, googleClient(c.env))).token, body.driveFileId).catch(() => undefined);
      }
      return c.json({ ok: true, wanted: false });
    }
    if (body.error || !body.driveFileId) {
      await finish(c.env, jobId, body.unchanged ? undefined : (body.error ?? 'The converter didn’t send a copy.'));
      return c.json({ ok: true });
    }
    try {
      const open = await openDrive(c.env);
      if (!open) return c.json({ error: 'No Google Drive is connected.' }, 409);
      const folder = await episodeFolder(c.env, open.token, open.drive, job.episode_id);
      const file = await fileInfo(open.token, body.driveFileId);
      if (!file || file.trashed || !file.parents.includes(folder)) return c.json({ error: 'The copy isn’t in the episode’s folder.' }, 400);
      const fixes = JSON.stringify((Array.isArray(body.fixes) ? body.fixes : []).map((f) => String(f).slice(0, 200)).slice(0, 10));
      const swapped = await c.env.DB.prepare(
        'UPDATE episode_graphics SET drive_file_id = ?, file_name = ?, size = ?, md5 = ?, fixes = ?, convert_error = NULL, shared = 0 WHERE episode_id = ? AND element_id = ? AND drive_file_id = ?',
      )
        .bind(file.id, file.name, file.size, file.md5, fixes, job.episode_id, job.element_id, job.drive_file_id)
        .run();
      await c.env.DB.prepare('DELETE FROM graphic_conversions WHERE job_id = ?').bind(jobId).run();
      if (!swapped.meta.changes) {
        await deleteForever(open.token, file.id).catch(() => undefined);
        return c.json({ ok: true, wanted: false });
      }
      // The original goes for good (RG: the converted graphic replaces it); the copy is shared for Drive's player.
      await deleteForever(open.token, job.drive_file_id).catch(() => undefined);
      if (await shareByLink(open.token, file.id).then(() => true, () => false)) {
        await c.env.DB.prepare('UPDATE episode_graphics SET shared = 1 WHERE episode_id = ? AND element_id = ?').bind(job.episode_id, job.element_id).run();
      }
      return c.json({ ok: true, wanted: true });
    } catch (e) {
      return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
    }
  });
}
