// SPDX-License-Identifier: AGPL-3.0-only
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test as base } from '@playwright/test';
import { freePort, stackEnabled, startWorkerStack, type WorkerStack } from '../scripts/e2e-stack';
import { resetPostgres } from './flows/reset';

// A demo store of its own for every spec FILE that imports `test` from here.
//
// The demo store is one JSON file per server, and the specs of the Admin modules write to it (users, rules, imports, updates,
// audit events). Run together on one server they change each other's counts ("141 issues", "14 alerts", the first ten audit
// rows) and a second run would start from the first run's leftovers. Here each worker starts `next start` from the build
// on a free port the first time a file needs it, and starts another when the worker moves to the
// next file: a file always begins on the store the fixtures generate, whatever ran before, in any order, in parallel.
// The emergency credentials made in playwright.config.ts are handed on in process.env. Files that only read (the matrix,
// states and structure specs, the shell specs) keep the shared server on port 3123, which also gets a fresh store per run.

export interface Instance {
  readonly file: string;
  readonly url: string;
  readonly child: ChildProcess;
}
export interface Holder {
  current: Instance | undefined;
}

const WEB = path.join(import.meta.dirname, '../apps/web');
const NEXT = path.join(WEB, 'node_modules/next/dist/bin/next');

/**
 * Starts a fresh `next start` for one spec file on a free port.
 * With a worker stack it talks to that worker's own Go server.
 */
export async function startFileServer(file: string, apiUrl?: string): Promise<Instance> {
  const port = await freePort();
  // `next start` from the build, in apps/web so it reads apps/web/.env.local (DEMO_SESSION_SECRET) like the shared server.
  const child = spawn(process.execPath, [NEXT, 'start', '-p', String(port)], {
    cwd: WEB,
    env: {
      ...process.env,
      ...(apiUrl === undefined ? {} : { OPENDISPATCH_API_URL: apiUrl }),
      NEXT_TELEMETRY_DISABLED: '1',
      // Empty on purpose: overrides the Basic Auth gate.
      OPENDISPATCH_BASIC_AUTH_USER: '',
      OPENDISPATCH_BASIC_AUTH_PASSWORD: '',
    },
    stdio: 'ignore',
  });
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 100_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/en`)).ok) break;
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`The server for ${file} did not start on port ${port}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { file, url, child };
}

export function stopFileServer(instance: Instance | undefined): void {
  if (instance === undefined) return;
  instance.child.kill('SIGTERM');
}

// Back to the fixture baseline: the worker's own database, or the shared one.
async function freshBaseline(stack: WorkerStack | null): Promise<void> {
  if (stack !== null) return stack.restore();
  const apiUrl = process.env['OPENDISPATCH_API_URL'];
  if (!apiUrl) return;
  resetPostgres();
  await fetch(`${apiUrl}/_internal/test/reset`, { method: 'POST' }).catch(() => undefined);
}

// 'describe': a fresh database per describe.
export type ServerScope = 'file' | 'describe';

export const test = base.extend<{ serverScope: ServerScope }, { holder: Holder; stack: WorkerStack | null }>({
  serverScope: ['file', { option: true }],
  stack: [
    async ({}, provide) => {
      const stack = stackEnabled() ? await startWorkerStack() : null;
      await provide(stack);
      await stack?.stop();
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  holder: [
    async ({}, provide) => {
      const holder: Holder = { current: undefined };
      await provide(holder);
      stopFileServer(holder.current);
    },
    { scope: 'worker' },
  ],
  // The first test of a file waits here for its server (about 5 seconds; the fixture time counts inside the test timeout).
  baseURL: async ({ holder, stack, serverScope }, provide, testInfo) => {
    const key = serverScope === 'file' ? testInfo.file : [testInfo.file, ...testInfo.titlePath.slice(1, -1)].join(' > ');
    if (holder.current?.file !== key) {
      stopFileServer(holder.current);
      holder.current = undefined;
      await freshBaseline(stack);
      holder.current = await startFileServer(key, stack?.apiUrl);
    }
    await provide(holder.current.url);
  },
});

export { expect };
