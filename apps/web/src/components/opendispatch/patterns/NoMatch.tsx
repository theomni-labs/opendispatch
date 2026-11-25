'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, EmptyState } from '@opendispatch/ui';
import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUrlState } from './useUrlState';

export interface NoMatchProps {
  /** "No users match": the module's own line. Default: "Nothing matches". */
  readonly title?: string | undefined;
  /** The parameters Clear all removes: the search text and every filter of the list. */
  readonly clearParams: readonly string[];
}

/**
 * The empty state of a list that has rows but none for the current search and filters (the mockups' "No users match"
 * with Clear all). Pass it as the `emptyState` of AdminTable. A list with no rows at all shows the module's own empty
 * state instead (ScreenEmpty), which the screen decides on the server.
 */
export function NoMatch({ title, clearParams }: NoMatchProps) {
  const t = useTranslations();
  const url = useUrlState();
  return (
    <EmptyState
      compact
      icon={<SearchX />}
      title={title ?? t('patterns.list.noMatch')}
      action={
        <Button variant="secondary" size="sm" onClick={() => url.update(Object.fromEntries(clearParams.map((key) => [key, null])))}>
          {t('common.clearAll')}
        </Button>
      }
    />
  );
}
