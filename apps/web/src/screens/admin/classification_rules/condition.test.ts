// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { defaultDraft, draftOf, draftsOf, enumValuesOf, kindOf, operatorsFor, predicateOf, predicatesOf, valueText } from './condition';

// The condition builder's model: rows of field, operator and value in, the data layer's predicates out; a rule that tests a field
// the list does not have keeps its field and the kind of its value.
describe('kindOf and operatorsFor', () => {
  it('takes the kind of a known field from the list, and of an unknown one from its value', () => {
    expect(kindOf('parties_involved')).toBe('num');
    expect(kindOf('injury_present')).toBe('bool');
    expect(kindOf('case_type')).toBe('enum');
    expect(kindOf('road_speed', 90)).toBe('num');
    expect(kindOf('road_speed', [90, 100])).toBe('num');
    expect(kindOf('weather_clear', true)).toBe('bool');
    expect(kindOf('district_name', 'North')).toBe('text');
  });

  it('offers only the operators that mean something for a kind', () => {
    expect(operatorsFor('bool')).toEqual(['eq', 'neq']);
    expect(operatorsFor('num')).toEqual(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in']);
    expect(operatorsFor('enum')).toEqual(['eq', 'neq', 'in']);
  });
});

describe('drafts and predicates', () => {
  it('round-trips a stored condition unchanged, including a list and an unknown field', () => {
    const condition = {
      match: 'any',
      predicates: [
        { field: 'parties_involved', operator: 'gte', value: 4 },
        { field: 'injury_present', operator: 'eq', value: true },
        { field: 'case_type', operator: 'in', value: ['Unlisted', 'Standard case'] },
        { field: 'road_speed', operator: 'lt', value: 90 },
      ],
    } as const;
    const drafts = draftsOf(condition);
    expect(drafts[2]).toEqual({ field: 'case_type', kind: 'enum', operator: 'in', value: 'Unlisted, Standard case' });
    expect(drafts[3]?.kind).toBe('num');
    expect(predicatesOf(drafts)).toEqual(condition.predicates);
  });

  it('sends a number as a number, a yes or no as a boolean, and a name as text', () => {
    expect(predicateOf({ field: 'parties_involved', kind: 'num', operator: 'eq', value: ' 3 ' })).toEqual({ field: 'parties_involved', operator: 'eq', value: 3 });
    expect(predicateOf({ field: 'injury_present', kind: 'bool', operator: 'neq', value: 'false' })).toEqual({ field: 'injury_present', operator: 'neq', value: false });
    expect(predicateOf({ field: 'case_type', kind: 'enum', operator: 'eq', value: 'Unlisted' })).toEqual({ field: 'case_type', operator: 'eq', value: 'Unlisted' });
  });

  it('waits for a complete row: a missing or wrong value, an empty list, no rows', () => {
    expect(predicateOf({ field: 'parties_involved', kind: 'num', operator: 'eq', value: '' })).toBeUndefined();
    expect(predicateOf({ field: 'parties_involved', kind: 'num', operator: 'eq', value: 'three' })).toBeUndefined();
    expect(predicateOf({ field: 'parties_involved', kind: 'num', operator: 'in', value: '1, x' })).toBeUndefined();
    expect(predicateOf({ field: 'case_type', kind: 'enum', operator: 'in', value: ' , ' })).toBeUndefined();
    expect(predicateOf({ field: 'case_type', kind: 'enum', operator: 'eq', value: 'x'.repeat(121) })).toBeUndefined();
    expect(predicatesOf([])).toBeUndefined();
    expect(predicatesOf([defaultDraft('parties_involved', []), { field: 'parties_involved', kind: 'num', operator: 'eq', value: '' }])).toBeUndefined();
  });

  it('starts a row with a value of its kind, the first case type for the case type field', () => {
    expect(defaultDraft('injury_present', [])).toMatchObject({ kind: 'bool', operator: 'eq', value: 'true' });
    expect(defaultDraft('parties_involved', [])).toMatchObject({ kind: 'num', value: '1' });
    expect(defaultDraft('case_type', ['Standard case', 'Unlisted'])).toMatchObject({ kind: 'enum', value: 'Standard case' });
    expect(defaultDraft('road_speed', [])).toMatchObject({ kind: 'text', value: '' });
  });

  it('shows a list as comma separated text and a value as its text', () => {
    expect(valueText([1, 2])).toBe('1, 2');
    expect(valueText(false)).toBe('false');
    expect(draftOf({ field: 'x_y', operator: 'eq', value: 'a' }).kind).toBe('text');
  });
});

// the spec's criteria as builder rows.
describe('the new rule criteria', () => {
  it('lists each with its kind and starts an enum on its own first value', () => {
    expect(kindOf('severity')).toBe('enum');
    expect(kindOf('claim_value_sar')).toBe('num');
    expect(kindOf('damage_assessment_method')).toBe('enum');
    expect(kindOf('location_type')).toBe('enum');
    expect(kindOf('customer_preference')).toBe('enum');
    expect(enumValuesOf('location_type', ['Standard case'])).toEqual(['dense_urban', 'urban', 'suburban', 'highway', 'rural']);
    expect(enumValuesOf('case_type', ['Standard case'])).toEqual(['Standard case']);
    expect(defaultDraft('severity', ['Standard case']).value).toBe('minor');
  });

  it('turns rows on the new criteria into predicates', () => {
    const rows = [
      defaultDraft('damage_assessment_method', []),
      { ...defaultDraft('claim_value_sar', []), operator: 'lt' as const, value: '8000' },
      { ...defaultDraft('location_type', []), operator: 'in' as const, value: 'dense_urban, urban' },
      { ...defaultDraft('customer_preference', []), value: 'remote' },
    ];
    expect(predicatesOf(rows)).toEqual([
      { field: 'damage_assessment_method', operator: 'eq', value: 'photo' },
      { field: 'claim_value_sar', operator: 'lt', value: 8000 },
      { field: 'location_type', operator: 'in', value: ['dense_urban', 'urban'] },
      { field: 'customer_preference', operator: 'eq', value: 'remote' },
    ]);
  });
});
