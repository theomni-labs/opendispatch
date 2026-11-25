// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { missingRequired, nextVersion, renamesOf, VERSION_PATTERN } from './mappingHelp';
import type { MappingSuggestionView } from './types';

const view: MappingSuggestionView = {
  provider: 'fake',
  model: 'fake-1',
  duration_ms: 1,
  baseVersion: 'generic_csv_v1',
  versions: ['generic_csv_v1', 'generic_csv_v2'],
  sent: '{}',
  columns: [],
  fields: [
    { field: 'external_id', column: 'RecordID', required: true },
    { field: 'latitude', column: 'Latitude', required: true },
    { field: 'severity', column: 'Severity', required: false },
  ],
};

describe('mapping help', () => {
  it('proposes the first free version', () => {
    expect(nextVersion('generic_csv_v1', view.versions)).toBe('generic_csv_v3');
    expect(nextVersion('custom', [])).toBe('custom_v2');
    expect(VERSION_PATTERN.test('generic_csv_v3')).toBe(true);
    expect(VERSION_PATTERN.test('Customer v3')).toBe(false);
  });

  it('lists required fields with no column', () => {
    expect(missingRequired(view, { 'Case Ref': 'external_id', Lat: '' })).toEqual(['latitude']);
    expect(missingRequired(view, { 'Case Ref': 'external_id', Lat: 'latitude' })).toEqual([]);
  });

  it('saves only the columns whose name changed', () => {
    expect(renamesOf(view, { RecordID: 'external_id', Lat: 'latitude', Remarks: '' })).toEqual([{ source_column: 'Lat', internal_field: 'latitude' }]);
  });
});
