// SPDX-License-Identifier: AGPL-3.0-only
// listImportMappings reads config/mappings/ only. Every other
// export here is api-backed (ImportJob/DataQualityIssue/Case): imports.live.test.ts.

import { describe, expect, it } from 'vitest';
import { listImportMappings } from './imports';
import { ctxFor, expectValid, withTempDemoState } from './test-support';

withTempDemoState();

describe('import mappings (config/mappings/, pure)', () => {
  it('lists the versioned mapping from config/mappings', async () => {
    const ctx = ctxFor('administrator');
    const mappings = await listImportMappings(ctx);
    expectValid('ImportMappingInfoList', mappings);
    expect(mappings.items.map((m) => m.version)).toContain('generic_csv_v1');
    expect(mappings.items[0]!.columns.find((c) => c.internal_field === 'registered_at')).toMatchObject({ source_column: 'RegisteredTime', required: true });
  });
});
