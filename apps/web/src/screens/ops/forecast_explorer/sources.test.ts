// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { accuracySources, runSources } from './sources';

const acc = { run: { id: 'r', model_version: 'ensemble-4', created_at: '2026-09-11T02:04:00+03:00' }, data_source: 'LIVE', mixed_sources: false } as const;

describe('forecast sources', () => {
  it('takes the run source and every input source, once each', () => {
    expect(runSources({ data_source: 'LIVE', input_data_sources: ['LIVE', 'IMPORTED'] })).toEqual(['LIVE', 'IMPORTED']);
    expect(runSources({ data_source: 'IMPORTED' })).toEqual(['IMPORTED']);
    expect(runSources(undefined)).toEqual([]);
  });

  it('is one source when the run and the cases agree', () => {
    expect(accuracySources(acc, { data_source: 'LIVE', input_data_sources: ['LIVE'] })).toEqual({ sources: ['LIVE'], mixed: false });
  });

  it('says mixed when the run and the cases differ', () => {
    expect(accuracySources(acc, { data_source: 'SYNTHETIC', input_data_sources: ['SYNTHETIC'] })).toEqual({ sources: ['SYNTHETIC', 'LIVE'], mixed: true });
  });

  it('says mixed when the cases alone are mixed', () => {
    expect(accuracySources({ ...acc, mixed_sources: true }, { data_source: 'LIVE' })).toEqual({ sources: ['LIVE'], mixed: true });
  });

  it('has no source without a run', () => {
    expect(accuracySources({ ...acc, run: null }, undefined)).toEqual({ sources: [], mixed: false });
  });
});
