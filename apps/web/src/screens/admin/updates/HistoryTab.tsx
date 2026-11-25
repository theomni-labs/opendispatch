'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, DataTable, StatusPill, type Column, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { clockOf } from './dates';
import { DataText, useWhen } from './UpdatesShared';
import type { HistoryRowView } from './types';
import styles from './Updates.module.css';

// The History tab: every update and rollback, with who approved it
// and in which window. The line under the result is translated from what happened (kind and result); a skip also shows the
// reason the person wrote (data, as typed). THE UPDATE AGENT IS A STUB: the data layer's own notes say "(stub)".

const RESULT_TONE: Readonly<Record<HistoryRowView['result'], Tone>> = { succeeded: 'success', failed: 'danger', rolled_back: 'warning', skipped: 'neutral', cancelled: 'neutral' };

/** The reason a person gave when they skipped: the data layer's note is `<reason> (stub)`. */
function skipReason(note: string | null): string | null {
  if (note === null) return null;
  const text = note.replace(/\s*\(stub\)\s*$/, '').trim();
  return text === '' ? null : text;
}

export function HistoryTab({ rows }: { rows: readonly HistoryRowView[] }) {
  const m = useTranslations('admin.updates');
  const when = useWhen();

  function noteOf(row: HistoryRowView): string {
    if (row.kind === 'skip') return m('h.nSkip');
    if (row.kind === 'resume') return m('h.nResume');
    if (row.kind === 'rollback') return m('h.nRollback');
    if (row.kind === 'restore') return m('h.nRestore');
    if (row.result === 'rolled_back') return m('h.nFail');
    if (row.result === 'failed') return m('h.nFailMig');
    if (row.result === 'cancelled') return m('h.nCancelled');
    if (row.kind === 'emergency_override') return m('h.nEmg');
    if (row.fromVersion === null) return m('h.n0');
    return m('h.n1');
  }

  const columns: Column<HistoryRowView>[] = [
    {
      key: 'version',
      header: m('h.version'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <span className={styles.strong} translate="no">
            {row.version}
          </span>
          {row.fromVersion === null ? null : (
            <span className={styles.meta}>
              {m('h.from')} <bdi dir="ltr" translate="no">{row.fromVersion}</bdi>
            </span>
          )}
        </span>
      ),
    },
    { key: 'kind', header: m('h.kind'), hideBelow: 'md', cell: (row) => m(`k.${row.kind}`) },
    {
      key: 'result',
      header: m('h.result'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <StatusPill status={m(`r.${row.result}`)} tone={RESULT_TONE[row.result]} size="sm" />
          <span className={styles.meta}>{noteOf(row)}</span>
          {row.kind === 'skip' && skipReason(row.note) !== null ? <span className={styles.meta}><DataText>{skipReason(row.note)}</DataText></span> : null}
        </span>
      ),
    },
    {
      key: 'approved',
      header: m('h.approved'),
      cell: (row) =>
        row.approvedBy.length === 0 ? (
          <span className={styles.meta}>-</span>
        ) : (
          <span className={styles.stackTight}>
            {row.approvedBy.map((name) => (
              <span key={name} translate="no">
                {name}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'window',
      header: m('h.window'),
      hideBelow: 'md',
      cell: (row) =>
        row.windowStart === null ? (
          <span className={styles.meta}>{row.kind === 'emergency_override' ? m('h.outside') : '-'}</span>
        ) : (
          <span className={styles.stackTight}>
            <span translate="no">{when.weekdayDate(row.windowStart)}</span>
            <span className={styles.meta}>
              <bdi dir="ltr" translate="no">{clockOf(row.windowStart)}</bdi>
            </span>
          </span>
        ),
    },
    {
      key: 'started',
      header: m('h.started'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <span className={styles.strong}>
            <bdi translate="no">{when.format.date(row.startedAt)}</bdi>
          </span>
          <span className={styles.meta}>
            <bdi dir="ltr" translate="no">{when.format.time(row.startedAt)}</bdi>
          </span>
        </span>
      ),
    },
  ];

  return (
    <Card padding="none">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{m('tab.history')}</h2>
      </div>
      <DataTable
        pageSize={25}
        caption={m('tab.history')}
        columns={columns}
        rows={[...rows]}
        getRowId={(row) => row.id}
        rowTone={(row) => (row.result === 'rolled_back' ? 'warning' : row.result === 'failed' ? 'danger' : undefined)}
        emptyState={<p className={styles.empty}>{m('h.none')}</p>}
      />
    </Card>
  );
}
