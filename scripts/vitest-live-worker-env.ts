// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll } from 'vitest';

// Points each live worker at its own Go server.
const workers = Number(process.env['VITEST_LIVE_WORKERS'] ?? '1');
if (workers > 1) {
  const id = Number(process.env['VITEST_POOL_ID']);
  if (!Number.isInteger(id) || id < 1 || id > workers) throw new Error(`Bad VITEST_POOL_ID: ${String(process.env['VITEST_POOL_ID'])}`);
  process.env['OPENDISPATCH_API_URL'] = `http://127.0.0.1:${String(Number(process.env['VITEST_LIVE_BASE_PORT'] ?? '8100') + id)}`;
}

// Files share one database: start each from the baseline.
beforeAll(async () => {
  const res = await fetch(`${process.env['OPENDISPATCH_API_URL'] ?? 'http://127.0.0.1:8090'}/_internal/test/reset?master=1`, { method: 'POST' });
  if (!res.ok) throw new Error(`Test reset answered ${String(res.status)}: ${(await res.text()).slice(0, 300)}`);
});
