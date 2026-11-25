// SPDX-License-Identifier: AGPL-3.0-only
// Live project setup: one Go server + database per worker.
// VITEST_LIVE_WORKERS=1 (default) keeps the shared server.
import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import serialSetup from './vitest-global-setup';

const run = promisify(execFile);
const ROOT = path.join(import.meta.dirname, '..');
const GO_DIR = path.join(ROOT, 'apps/api-go');
// VITEST_LIVE_BASE_PORT: a free port range.
export const BASE_PORT = Number(process.env['VITEST_LIVE_BASE_PORT'] ?? '8100');

export function liveWorkers(): number {
  const n = Number(process.env['VITEST_LIVE_WORKERS'] ?? '1');
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export function withDb(url: string, db: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${db}`;
  return parsed.toString();
}

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set.`);
  return value;
}

export async function waitHealthy(port: number, child: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Go server on ${String(port)} exited (${String(child.exitCode)}).`);
    try {
      if ((await fetch(`http://127.0.0.1:${String(port)}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Go server on ${String(port)} never became healthy.`);
}

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const workers = liveWorkers();
  if (workers === 1) {
    serialSetup();
    return undefined;
  }
  const ownerUrl = required('OPENDISPATCH_MIGRATION_DATABASE_URL');
  const appUrl = required('OPENDISPATCH_DATABASE_URL');
  const adminUrl = process.env['OPENDISPATCH_ADMIN_DATABASE_URL'] ?? ownerUrl;
  const baseDb = decodeURIComponent(new URL(ownerUrl).pathname.slice(1));
  const ownerRole = decodeURIComponent(new URL(ownerUrl).username);
  const appRole = decodeURIComponent(new URL(appUrl).username);
  const template = `${baseDb}_tpl`;
  const dbs = Array.from({ length: workers }, (_, i) => `${baseDb}_w${String(i + 1)}`);

  const bin = path.join(os.tmpdir(), `opendispatch-live-api-${String(process.pid)}`);
  execFileSync('go', ['build', '-o', bin, './cmd/api'], { cwd: GO_DIR, stdio: 'inherit' });

  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const servers: ChildProcess[] = [];
  const startGo = async (db: string, port: number): Promise<ChildProcess> => {
    const child = spawn(bin, [], {
      cwd: GO_DIR,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        OPENDISPATCH_OWNER_DATABASE_URL: withDb(ownerUrl, db),
        OPENDISPATCH_APP_DATABASE_URL: withDb(appUrl, db),
        OPENDISPATCH_MIGRATIONS_DIR: path.join(GO_DIR, 'migrations'),
        OPENDISPATCH_LISTEN_ADDR: `127.0.0.1:${String(port)}`,
        OPENDISPATCH_TEST_ROUTES: '1',
        OPENDISPATCH_AUTH_MODE: 'demo',
      },
    });
    servers.push(child);
    await waitHealthy(port, child);
    return child;
  };
  const dropAll = async (): Promise<void> => {
    for (const db of [...dbs, template]) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  };
  const stopAll = (): void => {
    for (const child of servers) child.kill('SIGTERM');
    servers.length = 0;
  };

  try {
    await dropAll();
    await admin.unsafe(`CREATE DATABASE "${template}" OWNER "${ownerRole}"`);
    const tpl = postgres(withDb(ownerUrl, template), { max: 1, onnotice: () => undefined });
    try {
      await tpl.unsafe(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
      await tpl.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`);
    } finally {
      await tpl.end();
    }
    const migrator = await startGo(template, BASE_PORT);
    await run('pnpm', ['exec', 'tsx', 'scripts/db/seed-postgres-from-fixtures.ts', '--reset'], {
      cwd: ROOT,
      env: { ...process.env, OPENDISPATCH_MIGRATION_DATABASE_URL: withDb(ownerUrl, template) },
    });
    migrator.kill('SIGTERM');
    await new Promise((resolve) => migrator.once('exit', resolve));
    for (const db of dbs) await admin.unsafe(`CREATE DATABASE "${db}" TEMPLATE "${template}" OWNER "${ownerRole}"`);
    await Promise.all(dbs.map((db, i) => startGo(db, BASE_PORT + i + 1)));
  } catch (error) {
    stopAll();
    await dropAll().catch(() => undefined);
    await admin.end();
    fs.rmSync(bin, { force: true });
    throw error;
  }

  return async () => {
    stopAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await dropAll().catch(() => undefined);
    await admin.end();
    fs.rmSync(bin, { force: true });
  };
}
