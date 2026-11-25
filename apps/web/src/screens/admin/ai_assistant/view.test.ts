// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { AssistantOverview } from '@/lib/types';
import { toView } from './view';

const base: AssistantOverview = {
  status: 'on',
  provider: 'ollama',
  model: 'qwen2.5:7b-instruct',
  offline: true,
  key: 'not_needed',
  set_in: 'server_environment',
  window_days: 7,
  totals: { calls: 8, successes: 6, within_10s: 1 },
  usage: [{ feature: 'explain', calls: 8, successes: 6, failures: 2, denied: 0, rejected: null, retried: 3, fallbacks: 1, median_ms: 26000, p90_ms: 44000 }],
  last_test: { ok: false, duration_ms: 30000, error_code: 'timeout', tested_at: '2026-10-04T09:00:00+03:00' },
  data_source: 'SYNTHETIC',
};

describe('toView', () => {
  it('maps the overview and works out the success share', () => {
    const v = toView(base);
    expect(v.successPct).toBe(75);
    expect(v.usage[0]).toEqual({ feature: 'explain', calls: 8, successes: 6, rejected: null, retried: 3, fallbacks: 1, medianMs: 26000, p90Ms: 44000 });
    expect(v.lastTest).toEqual({ ok: false, durationMs: 30000, errorCode: 'timeout', testedAt: '2026-10-04T09:00:00+03:00' });
  });

  it('has no share and no test when nothing ran', () => {
    const v = toView({ ...base, totals: { calls: 0, successes: 0, within_10s: 0 }, usage: [], last_test: null });
    expect(v.successPct).toBeNull();
    expect(v.lastTest).toBeNull();
    expect(v.usage).toEqual([]);
  });
});
