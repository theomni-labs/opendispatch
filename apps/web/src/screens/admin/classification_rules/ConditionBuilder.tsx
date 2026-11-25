'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, IconButton, Input, SegmentedControl, Select } from '@opendispatch/ui';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { defaultDraft, ENUM_VALUES, enumValuesOf, FIELDS, operatorsFor, type PredicateDraft } from './condition';
import type { Operator } from './types';
import styles from './ClassificationRules.module.css';

// The condition builder: "match all or any of" and rows of field, operator and value. Rows are text
// while they are edited (condition.ts turns them into the data layer's predicates), and a row never needs code. The field list
// is a constant (DG16); a rule that tests a field the list does not have keeps that field.

export interface ConditionBuilderProps {
  readonly match: 'all' | 'any';
  readonly onMatch: (match: 'all' | 'any') => void;
  readonly rows: readonly PredicateDraft[];
  readonly onRows: (rows: PredicateDraft[]) => void;
  /** The values of the "Case type" field. */
  readonly caseTypes: readonly string[];
  /** Display name per case type value. */
  readonly caseTypeLabels?: Readonly<Record<string, string>> | undefined;
  /** A version that is not a draft: shown, not changed. */
  readonly disabled: boolean;
}

/** A list's options, plus a stored value it lacks (shown as is). */
function valueOptions(values: readonly string[], current: string, label: (value: string) => string): { value: string; label: string }[] {
  const all = values.includes(current) || current === '' ? values : [...values, current];
  return all.map((value) => ({ value, label: values.includes(value) ? label(value) : value }));
}

export function ConditionBuilder({ match, onMatch, rows, onRows, caseTypes, caseTypeLabels, disabled }: ConditionBuilderProps) {
  const m = useTranslations('admin.classification_rules');
  const change = (index: number, patch: Partial<PredicateDraft>) => onRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <section className={styles.builder}>
      <div className={styles.builderHead}>
        <h3 className={styles.sectionTitle}>{m('cond.title')}</h3>
        <SegmentedControl
          size="sm"
          ariaLabel={m('cond.title')}
          value={match}
          options={[
            { value: 'all', label: m('all') },
            { value: 'any', label: m('any') },
          ]}
          onChange={(next) => {
            if (!disabled && (next === 'all' || next === 'any')) onMatch(next);
          }}
        />
      </div>
      <div className={styles.rows}>
        {rows.map((row, index) => {
          const kind = row.kind;
          const known = FIELDS.some((f) => f.field === row.field);
          const operators = operatorsFor(kind);
          const asList = row.operator === 'in';
          return (
            <div key={index} className={styles.predicate} data-predicate="">
              <Select
                size="sm"
                width="auto"
                aria-label={m('cond.field')}
                value={row.field}
                disabled={disabled}
                options={[...FIELDS.map((f) => ({ value: f.field, label: m(`f.${f.field}`) })), ...(known ? [] : [{ value: row.field, label: row.field }])]}
                onChange={(event) => onRows(rows.map((r, i) => (i === index ? defaultDraft(event.target.value, caseTypes) : r)))}
              />
              <Select
                size="sm"
                width="auto"
                aria-label={m('cond.operator')}
                value={row.operator}
                disabled={disabled}
                options={operators.map((operator) => ({ value: operator, label: m(`op.${operator}`) }))}
                onChange={(event) => {
                  const operator = event.target.value as Operator;
                  // A list and a single value are typed differently: crossing between them starts the value again.
                  change(index, { operator, ...((operator === 'in') !== asList ? { value: defaultDraft(row.field, caseTypes).value } : {}) });
                }}
              />
              {kind === 'bool' && !asList ? (
                <Select
                  size="sm"
                  width="auto"
                  aria-label={m('cond.value')}
                  value={row.value}
                  disabled={disabled}
                  options={[
                    { value: 'true', label: m('yes') },
                    { value: 'false', label: m('no') },
                  ]}
                  onChange={(event) => change(index, { value: event.target.value })}
                />
              ) : kind === 'enum' && !asList && ENUM_VALUES[row.field] !== undefined ? (
                <Select
                  size="sm"
                  width="auto"
                  aria-label={m('cond.value')}
                  value={row.value}
                  disabled={disabled}
                  options={valueOptions(enumValuesOf(row.field, caseTypes), row.value, (value) => m(`val.${value}`))}
                  onChange={(event) => change(index, { value: event.target.value })}
                />
              ) : kind === 'enum' && !asList ? (
                <Select
                  size="sm"
                  width="auto"
                  aria-label={m('cond.value')}
                  value={row.value}
                  disabled={disabled}
                  translate="no"
                  options={(caseTypes.includes(row.value) || row.value === '' ? caseTypes : [...caseTypes, row.value]).map((value) => ({ value, label: caseTypeLabels?.[value] ?? value }))}
                  onChange={(event) => change(index, { value: event.target.value })}
                />
              ) : (
                <Input
                  size="sm"
                  className={styles.value}
                  aria-label={m('cond.value')}
                  type={kind === 'num' && !asList ? 'number' : 'text'}
                  value={row.value}
                  disabled={disabled}
                  translate="no"
                  dir="ltr"
                  placeholder={asList ? m('cond.list') : undefined}
                  onChange={(event) => change(index, { value: event.target.value })}
                />
              )}
              {disabled ? null : <IconButton icon={<X />} label={m('rm')} variant="ghost" size="sm" onClick={() => onRows(rows.filter((_, i) => i !== index))} />}
            </div>
          );
        })}
      </div>
      {disabled ? null : (
        <div>
          <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => onRows([...rows, defaultDraft('parties_involved', caseTypes)])}>
            {m('addCond')}
          </Button>
        </div>
      )}
    </section>
  );
}
