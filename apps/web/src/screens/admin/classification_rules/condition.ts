// SPDX-License-Identifier: AGPL-3.0-only
// The condition builder's model: a rule's condition as structured rows, never as code. Pure: no
// React, no Next. The list of fields a rule may test is a constant here (the mockup's list); the data layer accepts any
// snake_case field name, so a rule that tests another field still shows, and its row keeps that field.

import type { Condition, Operator, Predicate, PredicateValue } from './types';

export type FieldKind = 'num' | 'bool' | 'enum' | 'text';

/** The case attributes a rule can test, with the kind of value each takes. */
export const FIELDS: readonly { readonly field: string; readonly kind: 'num' | 'bool' | 'enum' }[] = [
  { field: 'parties_involved', kind: 'num' },
  { field: 'injury_present', kind: 'bool' },
  { field: 'severity', kind: 'enum' },
  { field: 'insured_party_count', kind: 'num' },
  { field: 'estimated_damage_sar', kind: 'num' },
  { field: 'claim_value_sar', kind: 'num' },
  { field: 'damage_assessment_method', kind: 'enum' },
  { field: 'multi_vehicle', kind: 'bool' },
  { field: 'pedestrian_involved', kind: 'bool' },
  { field: 'location_type', kind: 'enum' },
  { field: 'highway_or_outside_city_limits', kind: 'bool' },
  { field: 'customer_preference', kind: 'enum' },
  { field: 'customer_requests_field_attendance', kind: 'bool' },
  { field: 'case_type', kind: 'enum' },
];

/** The values of each enum field other than case_type. The api checks the same lists on the feeds. */
export const ENUM_VALUES: Readonly<Record<string, readonly string[]>> = {
  severity: ['minor', 'moderate', 'severe'],
  damage_assessment_method: ['photo', 'video', 'in_person'],
  location_type: ['dense_urban', 'urban', 'suburban', 'highway', 'rural'],
  customer_preference: ['none', 'remote', 'field'],
};

/** The values an enum field offers: its own list, else the case types. */
export const enumValuesOf = (field: string, caseTypes: readonly string[]): readonly string[] => ENUM_VALUES[field] ?? caseTypes;

const OPERATORS_BY_KIND: Readonly<Record<FieldKind, readonly Operator[]>> = {
  bool: ['eq', 'neq'],
  num: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'],
  enum: ['eq', 'neq', 'in'],
  text: ['eq', 'neq', 'in'],
};

export const operatorsFor = (kind: FieldKind): readonly Operator[] => OPERATORS_BY_KIND[kind];

/** The kind of a field: from the list, or, for a field the list does not have, from the value the rule holds. */
export function kindOf(field: string, value?: PredicateValue): FieldKind {
  const known = FIELDS.find((f) => f.field === field);
  if (known !== undefined) return known.kind;
  const sample = Array.isArray(value) ? value[0] : value;
  return typeof sample === 'boolean' ? 'bool' : typeof sample === 'number' ? 'num' : 'text';
}

/** One row of the builder while it is edited: the value is always text, as typed or chosen. `kind` is what the value is. */
export interface PredicateDraft {
  readonly field: string;
  readonly kind: FieldKind;
  readonly operator: Operator;
  readonly value: string;
}

/** The text a value shows as: `true`, `3`, or `a, b` for a list. */
export function valueText(value: PredicateValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export const draftOf = (predicate: Predicate): PredicateDraft => ({ field: predicate.field, kind: kindOf(predicate.field, predicate.value), operator: predicate.operator, value: valueText(predicate.value) });

export const draftsOf = (condition: Condition): PredicateDraft[] => condition.predicates.map(draftOf);

/** The row a new condition starts as, and what a row becomes when its field changes. */
export function defaultDraft(field: string, caseTypes: readonly string[]): PredicateDraft {
  const kind = kindOf(field);
  return { field, kind, operator: 'eq', value: kind === 'bool' ? 'true' : kind === 'enum' ? (enumValuesOf(field, caseTypes)[0] ?? '') : kind === 'num' ? '1' : '' };
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** The values of an `in` list: comma separated, each a number for a number field, else text. Empty items are dropped. */
function listOf(text: string, kind: FieldKind): (string | number)[] | undefined {
  const parts = text.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return undefined;
  if (kind === 'num') return parts.every((part) => NUMBER.test(part)) ? parts.map(Number) : undefined;
  return parts;
}

/** A row as the data layer wants it, or undefined when its value is missing or is not a value of its kind. */
export function predicateOf(draft: PredicateDraft): Predicate | undefined {
  const kind = draft.kind;
  const text = draft.value.trim();
  if (draft.operator === 'in') {
    const list = listOf(text, kind);
    return list === undefined ? undefined : { field: draft.field, operator: 'in', value: list };
  }
  if (kind === 'bool') return text === 'true' || text === 'false' ? { field: draft.field, operator: draft.operator, value: text === 'true' } : undefined;
  if (kind === 'num') return NUMBER.test(text) ? { field: draft.field, operator: draft.operator, value: Number(text) } : undefined;
  return text === '' || text.length > 120 ? undefined : { field: draft.field, operator: draft.operator, value: text };
}

/** Every row as predicates, or undefined when there is no row or one is incomplete (Save waits for a complete condition). */
export function predicatesOf(drafts: readonly PredicateDraft[]): Predicate[] | undefined {
  if (drafts.length === 0) return undefined;
  const out: Predicate[] = [];
  for (const draft of drafts) {
    const predicate = predicateOf(draft);
    if (predicate === undefined) return undefined;
    out.push(predicate);
  }
  return out;
}
