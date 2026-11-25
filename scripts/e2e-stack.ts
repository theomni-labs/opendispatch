// SPDX-License-Identifier: AGPL-3.0-only
// Isolated Go server and database per e2e worker.
// E2E_SHARED_API=1 keeps the one shared server.
import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { required, waitHealthy, withDb } from './vitest-live-workers';

const run = promisify(execFile);
const ROOT = path.join(import.meta.dirname, '..');
const GO_DIR = path.join(ROOT, 'apps/api-go');

export function loadRootEnv(): void {
  // The Go api reads the web app's DEMO_* secrets.
  for (const file of ['.env.local', 'apps/web/.env.local']) {
    try {
      process.loadEnvFile(path.join(ROOT, file));
    } catch {
      // CI sets the variables directly
    }
  }
}

export function stackEnabled(): boolean {
  if (process.env['E2E_SHARED_API'] === '1') return false;
  loadRootEnv();
  return Boolean(process.env['OPENDISPATCH_MIGRATION_DATABASE_URL']) && Boolean(process.env['OPENDISPATCH_DATABASE_URL']);
}

export function e2eWorkers(): number {
  const n = Number(process.env['E2E_WORKERS'] ?? '1');
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface Names {
  readonly ownerUrl: string;
  readonly appUrl: string;
  readonly adminUrl: string;
  readonly baseDb: string;
  readonly ownerRole: string;
  readonly appRole: string;
  readonly template: string;
}

function names(): Names {
  const ownerUrl = required('OPENDISPATCH_MIGRATION_DATABASE_URL');
  const appUrl = required('OPENDISPATCH_DATABASE_URL');
  const baseDb = decodeURIComponent(new URL(ownerUrl).pathname.slice(1));
  return {
    ownerUrl,
    appUrl,
    adminUrl: process.env['OPENDISPATCH_ADMIN_DATABASE_URL'] ?? ownerUrl,
    baseDb,
    ownerRole: decodeURIComponent(new URL(ownerUrl).username),
    appRole: decodeURIComponent(new URL(appUrl).username),
    template: `${baseDb}_e2e_tpl`,
  };
}

function startGo(bin: string, n: Names, db: string, port: number): Promise<ChildProcess> {
  const child = spawn(bin, [], {
    cwd: GO_DIR,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      OPENDISPATCH_OWNER_DATABASE_URL: withDb(n.ownerUrl, db),
      OPENDISPATCH_APP_DATABASE_URL: withDb(n.appUrl, db),
      OPENDISPATCH_MIGRATIONS_DIR: path.join(GO_DIR, 'migrations'),
      OPENDISPATCH_LISTEN_ADDR: `127.0.0.1:${String(port)}`,
      OPENDISPATCH_TEST_ROUTES: '1',
      OPENDISPATCH_AUTH_MODE: 'demo',
    },
  });
  return waitHealthy(port, child).then(() => child, (error: unknown) => {
    child.kill('SIGTERM');
    throw error;
  });
}

function stopGo(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

// No FORCE: a non-superuser owner cannot end the app role's sessions.
async function dropDb(admin: postgres.Sql, db: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${db}"`);
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006' || attempt >= 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function dropMatching(admin: postgres.Sql, baseDb: string): Promise<void> {
  const rows = await admin`SELECT datname FROM pg_database WHERE datname LIKE ${`${baseDb}\\_e2e\\_%`}`;
  for (const row of rows) await dropDb(admin, String(row['datname']));
}

async function createFromTemplate(admin: postgres.Sql, db: string, n: Names): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.unsafe(`CREATE DATABASE "${db}" TEMPLATE "${n.template}" OWNER "${n.ownerRole}"`);
      return;
    } catch (error) {
      // 55006: another worker is copying the template
      if ((error as { code?: string }).code !== '55006' || attempt >= 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

// Builds the Go binary and a migrated, seeded template once per run.
export async function buildTemplate(): Promise<() => Promise<void>> {
  const n = names();
  const bin = path.join(os.tmpdir(), `opendispatch-e2e-api-${String(process.pid)}`);
  execFileSync('go', ['build', '-o', bin, './cmd/api'], { cwd: GO_DIR, stdio: 'inherit' });
  const admin = postgres(n.adminUrl, { max: 1, onnotice: () => undefined });
  const cleanup = async (): Promise<void> => {
    await dropMatching(admin, n.baseDb).catch(() => undefined);
    await admin.end();
    fs.rmSync(bin, { force: true });
  };
  try {
    await dropMatching(admin, n.baseDb);
    await admin.unsafe(`CREATE DATABASE "${n.template}" OWNER "${n.ownerRole}"`);
    const tpl = postgres(withDb(n.ownerUrl, n.template), { max: 1, onnotice: () => undefined });
    try {
      await tpl.unsafe(`GRANT USAGE ON SCHEMA public TO "${n.appRole}"`);
      await tpl.unsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE "${n.ownerRole}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${n.appRole}"`);
    } finally {
      await tpl.end();
    }
    const migrator = await startGo(bin, n, n.template, await freePort());
    try {
      await run('pnpm', ['exec', 'tsx', 'scripts/db/seed-postgres-from-fixtures.ts', '--reset'], {
        cwd: ROOT,
        env: { ...process.env, OPENDISPATCH_MIGRATION_DATABASE_URL: withDb(n.ownerUrl, n.template) },
      });
    } finally {
      await stopGo(migrator);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  process.env['E2E_GO_BIN'] = bin;
  return cleanup;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(port, '127.0.0.1');
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

// Go for the shared next start: the port in OPENDISPATCH_API_URL.
export async function startSharedApi(): Promise<() => Promise<void>> {
  const url = new URL(process.env['OPENDISPATCH_API_URL'] ?? 'http://127.0.0.1:8090');
  const port = Number(url.port);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !port || (await portInUse(port))) return () => Promise.resolve();
  const n = names();
  const db = `${n.baseDb}_e2e_shared`;
  const admin = postgres(n.adminUrl, { max: 1, onnotice: () => undefined });
  await dropDb(admin, db);
  await createFromTemplate(admin, db, n);
  const child = await startGo(required('E2E_GO_BIN'), n, db, port).catch(async (error: unknown) => {
    await dropDb(admin, db).catch(() => undefined);
    await admin.end();
    throw error;
  });
  return async () => {
    await stopGo(child);
    await dropDb(admin, db).catch(() => undefined);
    await admin.end();
  };
}

export interface WorkerStack {
  readonly apiUrl: string;
  restore(): Promise<void>;
  stop(): Promise<void>;
}

// One database and Go server for this worker; restore() is back to the template.
export async function startWorkerStack(): Promise<WorkerStack> {
  const n = names();
  const bin = required('E2E_GO_BIN');
  const db = `${n.baseDb}_e2e_w${String(process.pid)}`;
  const admin = postgres(n.adminUrl, { max: 1, onnotice: () => undefined });
  let child: ChildProcess | undefined;
  let port = 0;
  const restore = async (): Promise<void> => {
    await stopGo(child);
    child = undefined;
    await dropDb(admin, db);
    await createFromTemplate(admin, db, n);
    port = await freePort();
    child = await startGo(bin, n, db, port);
  };
  await restore();
  return {
    get apiUrl() {
      return `http://127.0.0.1:${String(port)}`;
    },
    restore,
    async stop() {
      await stopGo(child);
      await dropDb(admin, db).catch(() => undefined);
      await admin.end();
    },
  };
}
