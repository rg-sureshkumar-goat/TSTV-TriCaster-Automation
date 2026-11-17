import { describe, expect, it } from 'vitest';
import { startWorkflow } from '../conversions.ts';
import type { Env } from '../env.ts';

describe('starting the graphic converter on GitHub (RG, Nov 17, 2026)', () => {
  it('runs the convert-graphic workflow with the job’s id', async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      asked.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await startWorkflow({ GITHUB_TOKEN: 'gh-key', CONVERTER_SECRET: 's' } as Env, 'job-1', fetchFn);
    expect(asked[0].url).toBe('https://api.github.com/repos/rg-sureshkumar-goat/TSTV-TriCaster-Automation/actions/workflows/convert-graphic.yml/dispatches');
    expect(JSON.parse(String(asked[0].init.body))).toEqual({ ref: 'main', inputs: { job: 'job-1' } });
    expect((asked[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gh-key');
  });

  it('says plainly when it isn’t set up, or GitHub says no', async () => {
    await expect(startWorkflow({} as Env, 'job-1')).rejects.toThrow('isn’t set up');
    const refused = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(startWorkflow({ GITHUB_TOKEN: 'x', CONVERTER_SECRET: 's' } as Env, 'job-1', refused)).rejects.toThrow('403');
  });
});
