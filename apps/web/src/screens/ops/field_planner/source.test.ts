// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { messageLeaves } from '@/i18n/message-tree';
import { loadMessages } from '@/i18n/messages';
import { modelFamilyKey, rosterSourceOf, sourceChipOf } from './source';

const translator = (locale: 'en' | 'ar') => {
  const leaves = messageLeaves(loadMessages(locale, 'ops.field_planner'));
  return (key: string): string => {
    const text = leaves[`ops.field_planner.${key}`];
    if (text === undefined) throw new Error(`missing ${locale} key ${key}`);
    return text;
  };
};

describe('rosterSourceOf', () => {
  it('is null when the field is null or absent (old rosters, engines off)', () => {
    expect(rosterSourceOf({ optimizer_source: null, fallback_reason: null, optimizer_status: null })).toBeNull();
    expect(rosterSourceOf({})).toBeNull();
  });

  it('reads the optimizer and its status, and a fallback with its reason', () => {
    expect(rosterSourceOf({ optimizer_source: 'optimizer', optimizer_status: 'partial' })).toEqual({ kind: 'optimizer', status: 'partial' });
    expect(rosterSourceOf({ optimizer_source: 'fallback', fallback_reason: 'engine_unavailable' })).toEqual({ kind: 'fallback', reason: 'engine_unavailable' });
  });
});

describe('sourceChipOf', () => {
  it('shows the optimizer and its status, success only when feasible', () => {
    const en = translator('en');
    expect(sourceChipOf({ kind: 'optimizer', status: 'feasible' }, en)).toEqual({ tone: 'success', label: 'Optimizer · Feasible', note: null });
    expect(sourceChipOf({ kind: 'optimizer', status: 'partial' }, en).tone).toBe('neutral');
    expect(sourceChipOf({ kind: 'optimizer', status: 'partial' }, en).note).toBe('Not every interval could be staffed');
    expect(sourceChipOf({ kind: 'optimizer', status: 'infeasible' }, en).note).toBe('No roster met every hard rule');
    expect(sourceChipOf({ kind: 'optimizer', status: null }, en).note).toBeNull();
    expect(sourceChipOf({ kind: 'optimizer', status: 'infeasible' }, en).label).toBe('Optimizer · Infeasible');
  });

  it('shows the fallback in the warning tone with the reason text, English', () => {
    const en = translator('en');
    expect(sourceChipOf({ kind: 'fallback', reason: 'no_forecast_for_day' }, en)).toEqual({ tone: 'warning', label: 'Fallback roster', note: 'No forecast for this day: run a forecast that covers it' });
    expect(sourceChipOf({ kind: 'fallback', reason: 'engine_unavailable' }, en).note).toBe('Engine unavailable');
    expect(sourceChipOf({ kind: 'fallback', reason: 'no_answer' }, en).note).toBe('No usable optimizer answer');
  });

  it('has every label and reason in Arabic', () => {
    const ar = translator('ar');
    expect(sourceChipOf({ kind: 'fallback', reason: 'no_forecast_for_day' }, ar)).toEqual({ tone: 'warning', label: 'جدول احتياطي', note: 'لا يوجد توقع لهذا اليوم: شغّل توقعًا يغطيه' });
    expect(sourceChipOf({ kind: 'fallback', reason: 'engine_unavailable' }, ar).note).toBe('المحرّك غير متاح');
    expect(sourceChipOf({ kind: 'fallback', reason: 'no_answer' }, ar).note).toBe('لا توجد إجابة صالحة من محرك التحسين');
    expect(sourceChipOf({ kind: 'optimizer', status: 'feasible' }, ar).label).toBe('محرك التحسين · ممكن');
    expect(sourceChipOf({ kind: 'optimizer', status: 'partial' }, ar).label).toBe('محرك التحسين · جزئي');
    expect(sourceChipOf({ kind: 'optimizer', status: 'partial' }, ar).note).toBe('تعذّر تغطية كل الفترات بالمندوبين');
    expect(sourceChipOf({ kind: 'optimizer', status: 'infeasible' }, ar).note).toBe('لم يستوفِ أي جدول كل القواعد الإلزامية');
    expect(sourceChipOf({ kind: 'optimizer', status: 'infeasible' }, ar).label).toBe('محرك التحسين · غير ممكن');
  });
});

describe('modelFamilyKey', () => {
  it('names CP-SAT and the greedy models, with every solver status in both languages', () => {
    expect(modelFamilyKey('cpsat-1')).toBe('model.cpsat');
    expect(modelFamilyKey('greedy-ls-0.3')).toBe('model.greedy');
    for (const locale of ['en', 'ar'] as const) {
      const t = translator(locale);
      for (const key of ['model.cpsat', 'model.greedy', 'solver.optimal', 'solver.feasible', 'solver.heuristic']) expect(t(key)).not.toBe('');
    }
    expect(translator('en')('solver.optimal')).toBe('Proven optimal');
  });
});
