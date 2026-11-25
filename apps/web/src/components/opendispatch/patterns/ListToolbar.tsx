'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { FilterBar, FilterChip } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { useUrlState } from './useUrlState';

// The search box and filter chips of a list, bound to the address bar:
//
//   <Card padding="none">
//     <ListToolbar searchLabel={t('search')} filters={[{ key: 'role', label: t('f.role'), options: [{ value: 'planner', label: '...' }] }]} />
//     <AdminTable ... />
//   </Card>
//
// The search text is debounced (300 ms by default) and written to `q` with `router.replace` inside a transition, so
// typing keeps its focus and the server is asked once per pause. A chip writes its option to its own parameter. The
// active filters show as removable chips with "Clear all" (filters only, as in the mockups; the search text has its own
// clear button). Every value is validated on the server again; a value that is not one of the options is ignored there.

export interface ToolbarFilter {
  /** The search parameter, for example `role`. */
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface ListToolbarProps {
  /** Placeholder and accessible name of the search box. Default: the generic "Search". */
  readonly searchLabel?: string | undefined;
  /** The parameter that holds the search text. Default `q`. Pass `false` for a list with no search box. */
  readonly searchParam?: string | false | undefined;
  readonly filters?: readonly ToolbarFilter[] | undefined;
  /** Buttons at the end of the bar (Export). */
  readonly actions?: ReactNode;
  readonly debounceMs?: number | undefined;
}

export function ListToolbar({ searchLabel, searchParam = 'q', filters = [], actions, debounceMs = 300 }: ListToolbarProps) {
  const t = useTranslations('patterns.toolbar');
  const url = useUrlState();
  const urlText = searchParam === false ? '' : (url.get(searchParam) ?? '');

  // The box holds what the person typed; the address holds what was last sent. The box follows the address only when the
  // address changed for another reason (Back, Clear all), never for the echo of the last thing sent, or a letter typed
  // while the server is answering would be wiped.
  const [text, setText] = useState(urlText);
  const [sent, setSent] = useState(urlText);
  const [seen, setSeen] = useState(urlText);
  if (urlText !== seen) {
    setSeen(urlText);
    if (urlText !== sent) {
      setSent(urlText);
      setText(urlText);
    }
  }

  const trimmed = text.trim();
  const update = url.update;
  useEffect(() => {
    if (searchParam === false || trimmed === sent) return undefined;
    const timer = setTimeout(() => {
      setSent(trimmed);
      update({ [searchParam]: trimmed === '' ? null : trimmed });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [trimmed, sent, searchParam, debounceMs, update]);

  const active = filters.flatMap((filter) => {
    const value = url.get(filter.key);
    const option = filter.options.find((o) => o.value === value);
    return option === undefined ? [] : [{ label: `${filter.label}: ${option.label}`, onRemove: () => url.update({ [filter.key]: null }) }];
  });

  return (
    <FilterBar
      {...(searchParam === false ? {} : { search: { value: text, onChange: setText, placeholder: searchLabel ?? t('search') } })}
      filters={filters.map((filter) => (
        <FilterChip
          key={filter.key}
          label={filter.label}
          options={[...filter.options]}
          {...(filter.options.some((o) => o.value === url.get(filter.key)) ? { value: url.get(filter.key) as string } : {})}
          onChange={(next) => url.update({ [filter.key]: next ?? null })}
        />
      ))}
      actions={actions}
      activeFilters={active}
      onClearAll={() => url.update(Object.fromEntries(filters.map((filter) => [filter.key, null])))}
    />
  );
}
