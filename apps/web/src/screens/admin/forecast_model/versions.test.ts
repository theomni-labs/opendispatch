// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ModelVersionList } from '@/lib/types';
import { activeEngineModel, isPlaceholderRefusal, liftOf, makeActiveBlock, versionRows } from './versions';

const reg = (version: string, status: string, placeholder = true) => ({ id: `id-${version}`, version, status, trained_at: '2026-09-01T00:00:00Z', engine_version: null, is_placeholder: placeholder }) as unknown as ModelVersionList['items'][number];
const registry = [reg('placeholder-0.2', 'candidate'), reg('placeholder-0.1', 'active')];

describe('activeEngineModel', () => {
  it('is the champion once engines run, so Make active shows at once', () => {
    expect(activeEngineModel('ensemble-4', 'ensemble-3')).toBe('ensemble-3');
    expect(activeEngineModel('ensemble-4', null)).toBe('ensemble-4');
    expect(activeEngineModel(null, 'ensemble-3')).toBeNull();
  });
  it('ranks the switched-to version Active and the old one Candidate', () => {
    const real = [reg('ensemble-3', 'active', false), reg('ensemble-4', 'retired', false)];
    const rows = versionRows(real, activeEngineModel('ensemble-4', 'ensemble-3'), undefined);
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      ['ensemble-3', 'active'],
      ['ensemble-4', 'retired'],
    ]);
  });
});

describe('versionRows', () => {
  it('keeps the registry as it is without an engine model', () => {
    expect(versionRows(registry, null, undefined).map((r) => r.status)).toEqual(['candidate', 'active']);
  });
  it('lists the engine model first as Active and demotes the placeholder', () => {
    const rows = versionRows(registry, 'seasonal-profile-1', { finished_at: '2026-10-01T12:00:00Z', engine_version: '0.1.0' });
    expect(rows.map((r) => [r.version, r.status])).toEqual([['seasonal-profile-1', 'active'], ['placeholder-0.2', 'candidate'], ['placeholder-0.1', 'candidate']]);
    expect(rows[0]).toMatchObject({ engine: '0.1.0', trainedAt: '2026-10-01T12:00:00Z', placeholder: false });
  });
  it('marks a registry row Active when it is the engine model', () => {
    const rows = versionRows([...registry, reg('seasonal-profile-1', 'candidate', false)], 'seasonal-profile-1', undefined);
    expect(rows.filter((r) => r.status === 'active').map((r) => r.version)).toEqual(['seasonal-profile-1']);
    expect(rows).toHaveLength(3);
  });
});

describe('engine version', () => {
  it('fills the engine version of a registry row that is the engine model', () => {
    const rows = versionRows([...registry, reg('seasonal-profile-1', 'candidate', false)], 'seasonal-profile-1', { engine_version: '0.2.0' });
    expect(rows.find((r) => r.version === 'seasonal-profile-1')?.engine).toBe('0.2.0');
    expect(rows.find((r) => r.version === 'placeholder-0.1')?.engine).toBeNull();
  });
});

describe('makeActiveBlock', () => {
  it('blocks placeholder rows only while an engine model is active', () => {
    expect(makeActiveBlock({ placeholder: true }, 'seasonal-profile-1')).toBe('placeholderOff');
    expect(makeActiveBlock({ placeholder: true }, null)).toBeNull();
    expect(makeActiveBlock({ placeholder: false }, 'seasonal-profile-1')).toBeNull();
  });
});

describe('isPlaceholderRefusal', () => {
  it('matches only the placeholder conflict', () => {
    expect(isPlaceholderRefusal({ code: 'conflict', message: 'placeholder_not_allowed' })).toBe(true);
    expect(isPlaceholderRefusal({ code: 'conflict', message: 'v1 is already the active version.' })).toBe(false);
    expect(isPlaceholderRefusal({ code: 'invalid', message: 'placeholder_not_allowed' })).toBe(false);
    expect(isPlaceholderRefusal(null)).toBe(false);
  });

  it('has the line in English and Arabic', async () => {
    const en = (await import('../../../../messages/admin/forecast_model/en.json')).default as { v: { placeholderOff: string } };
    const ar = (await import('../../../../messages/admin/forecast_model/ar.json')).default as { v: { placeholderOff: string } };
    expect(en.v.placeholderOff).toMatch(/not used while engines are on/);
    expect(ar.v.placeholderOff).toMatch(/المحركات/);
  });
});

describe('challenger', () => {
  const challenger = { model: 'ensemble-2', run: { finished_at: '2026-10-01T02:04:00+03:00', engine_version: '0.4.0' }, lift: { wape: -0.021, mape: 0.014 } };
  it('lists the challenger right after the active model, with its run and lift', () => {
    const rows = versionRows(registry, 'ensemble-3', { engine_version: '0.4.0' }, challenger);
    expect(rows.map((r) => [r.version, r.status])).toEqual([['ensemble-3', 'active'], ['ensemble-2', 'challenger'], ['placeholder-0.2', 'candidate'], ['placeholder-0.1', 'candidate']]);
    expect(rows[1]).toMatchObject({ id: 'challenger:ensemble-2', engine: '0.4.0', trainedAt: '2026-10-01T02:04:00+03:00', placeholder: false, lift: { wape: -0.021, mape: 0.014 } });
  });
  it('turns a registry row into the challenger instead of listing it twice', () => {
    const rows = versionRows([...registry, reg('ensemble-2', 'retired', false)], 'ensemble-3', undefined, { ...challenger, run: undefined, lift: null });
    expect(rows.filter((r) => r.version === 'ensemble-2')).toEqual([expect.objectContaining({ id: 'id-ensemble-2', status: 'challenger', lift: null })]);
  });
  it('shows no challenger that is the champion', () => {
    expect(versionRows(registry, 'ensemble-2', undefined, challenger).some((r) => r.status === 'challenger')).toBe(false);
  });
  it('reads the lift of the same challenger only', () => {
    const detail = { comparison: { challenger: 'ensemble-2', champion: 'ensemble-3', wape_lift: 0.12, mape_lift: null, error: '' } };
    expect(liftOf(detail, 'ensemble-2')).toEqual({ wape: 0.12, mape: null });
    expect(liftOf(detail, 'seasonal-profile-1')).toBeNull();
    expect(liftOf({ comparison: { ...detail.comparison, error: 'The engine ran ensemble-3' } }, 'ensemble-2')).toBeNull();
    expect(liftOf({}, 'ensemble-2')).toBeNull();
    expect(liftOf(undefined, 'ensemble-2')).toBeNull();
  });
});
