// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDemoDatabase } from './guard';

describe('assertDemoDatabase', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a local demo database', () => {
    expect(() => assertDemoDatabase('postgres://u:p@127.0.0.1:5432/opendispatch_demo')).not.toThrow();
  });

  it('refuses a database whose name is not a demo one', () => {
    expect(() => assertDemoDatabase('postgres://u:p@localhost/opendispatch')).toThrow(/not a demo database/);
  });

  it('refuses a remote host unless it is listed', () => {
    expect(() => assertDemoDatabase('postgres://u:p@postgres/opendispatch_demo')).toThrow(/not local/);
    vi.stubEnv('OPENDISPATCH_DEMO_DB_HOSTS', 'postgres');
    expect(() => assertDemoDatabase('postgres://u:p@postgres/opendispatch_demo')).not.toThrow();
  });
});
