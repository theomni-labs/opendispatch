// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CloseOutlined, DownOutlined, PlusCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Input as AntInput, Tag } from 'antd';
import type { KeyboardEvent, ReactNode } from 'react';
import { useLabels } from '../provider';
import { cx } from '../types';
import { Menu, type MenuEntry } from './menu';
import styles from './filter-bar.module.css';
import { defined } from './form-utils';

export interface FilterBarProps {
  /** A search box at the start. */
  search?: { value?: string | undefined; onChange?: ((value: string) => void) | undefined; placeholder?: string | undefined };
  /** Filter controls, usually FilterChips. */
  filters?: ReactNode;
  /** Actions at the end of the row. */
  actions?: ReactNode;
  /** The filters in force, each shown as a removable chip under the row. */
  activeFilters?: { label: string; onRemove: () => void }[] | undefined;
  onClearAll?: (() => void) | undefined;
  className?: string | undefined;
}

function SearchBox({ value, onChange, placeholder }: NonNullable<FilterBarProps['search']>) {
  const label = useLabels();
  const text = placeholder ?? label('searchInput.placeholder');
  const filled = value !== undefined && value !== '';
  return (
    <AntInput
      type="search"
      role="searchbox"
      size="small"
      value={value ?? ''}
      placeholder={text}
      aria-label={text}
      prefix={<SearchOutlined aria-label="" aria-hidden="true" className={styles.searchIcon} />}
      suffix={
        filled ? (
          <button type="button" className={styles.clear} aria-label={label('searchInput.clear')} onClick={() => onChange?.('')}>
            <CloseOutlined aria-label="" aria-hidden="true" />
          </button>
        ) : undefined
      }
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape' && filled) {
          event.preventDefault();
          onChange?.('');
        }
      }}
      className={styles.search}
    />
  );
}

/** A list's toolbar: search, filters and actions in one row, the filters in force as chips below. */
export function FilterBar({ search, filters, actions, activeFilters, onClearAll, className }: FilterBarProps) {
  const label = useLabels();
  const active = activeFilters ?? [];
  return (
    <div className={cx(styles.bar, className)}>
      <div className={styles.row}>
        {search ? <SearchBox {...search} /> : null}
        {filters ? <div className={styles.filters}>{filters}</div> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {active.length > 0 ? (
        <div className={styles.activeRow}>
          <span className={styles.activeLabel}>{label('filterBar.filteredBy')}</span>
          <ul className={styles.chips} role="list">
            {active.map((filter, index) => (
              <li key={`${filter.label}-${String(index)}`}>
                <Tag {...defined({ className: styles.chip })} bordered>
                  <span>{filter.label}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={label('filterBar.removeFilter', { label: filter.label })}
                    onClick={filter.onRemove}
                  >
                    <CloseOutlined aria-label="" aria-hidden="true" />
                  </button>
                </Tag>
              </li>
            ))}
          </ul>
          {onClearAll ? (
            <Button type="link" size="small" onClick={onClearAll} {...defined({ className: styles.clearAll })}>
              {label('filterBar.clearAll')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface FilterChipProps {
  label: string;
  value?: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
  className?: string | undefined;
}

/** A filter as a dashed button that opens a menu of choices (menuitemradio), with a Clear entry once set. */
export function FilterChip({ label, value, options, onChange, className }: FilterChipProps) {
  const text = useLabels();
  const isSet = value !== undefined && value !== '';
  const chosen = isSet ? options.find((option) => option.value === value) : undefined;
  const items: MenuEntry[] = [
    {
      type: 'radio-group',
      label,
      options: options.map((option) => ({ value: option.value, label: option.label })),
      value: isSet ? value : undefined,
      onValueChange: (next: string) => onChange(next),
    },
  ];
  if (isSet) items.push('separator', { label: text('filterBar.clearFilter'), icon: <CloseOutlined aria-hidden="true" aria-label="" />, onSelect: () => onChange(undefined) });

  return (
    <Menu
      label={label}
      items={items}
      trigger={
        <Button size="small" type={isSet ? 'default' : 'dashed'} {...defined({ className: cx(styles.filterChip, isSet && styles.filterChipSet, className) })}>
          {isSet ? null : <PlusCircleOutlined aria-label="" aria-hidden="true" />}
          <span className={styles.filterName}>{label}</span>
          {isSet ? (
            <>
              <span aria-hidden="true">:</span>
              <span className={styles.filterValue}>{chosen?.label ?? value}</span>
              <DownOutlined aria-label="" aria-hidden="true" className={styles.filterArrow} />
            </>
          ) : null}
        </Button>
      }
    />
  );
}
