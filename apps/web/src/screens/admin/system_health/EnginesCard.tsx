// SPDX-License-Identifier: AGPL-3.0-only
import { Card, CardHeader, EmptyState, SkeletonText, StatusPill, type Tone } from '@opendispatch/ui';
import { date, num, time } from '@opendispatch/ui/format';
import { Server } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { EngineDrawer, RetryButton } from './HealthForms';
import styles from './SystemHealth.module.css';
import { ENGINE_NAMES, type BreakerState, type EngineName, type EngineRow, type EnginesView } from './types';

// Engines card: own read, own states, drawer.

// demo-mode review hook: ?eng=
export type EnginesReview = 'stale' | 'empty' | 'loading' | 'error';
export const ENGINES_REVIEW: readonly EnginesReview[] = ['stale', 'empty', 'loading', 'error'];
export const isEngine = (value: string | undefined): value is EngineName => (ENGINE_NAMES as readonly string[]).includes(value ?? '');

// a breaker read as health: Closed is not "off"
const HEALTH: Readonly<Record<BreakerState, { readonly key: 'healthy' | 'degraded' | 'down'; readonly tone: Tone }>> = {
  closed: { key: 'healthy', tone: 'success' },
  half_open: { key: 'degraded', tone: 'warning' },
  open: { key: 'down', tone: 'danger' },
};
type Translate = Awaited<ReturnType<typeof getTranslations>>;

export interface EnginesCardProps {
  /** The read; absent under a review hook that skips it. */
  readonly view: EnginesView | undefined;
  readonly locale: 'en' | 'ar';
  readonly review?: EnginesReview | undefined;
  /** Checked against the engine names. */
  readonly open?: EngineName | undefined;
}

export async function EnginesCard({ view: read, locale, review, open }: EnginesCardProps) {
  const m = await getTranslations('admin.system_health');
  const title = m('eng.title');
  if (review === 'loading') return await EnginesLoading();
  const view: EnginesView = review === 'empty' ? { status: 'ok', asOf: '', stale: false, rows: [] } : review === 'error' || read === undefined ? { status: 'error' } : read;
  if (view.status === 'error') {
    return (
      <Card padding="none" data-engines="error">
        <CardHeader title={title} />
        <EmptyState compact tone="danger" title={m('eng.error')} action={<RetryButton />} />
      </Card>
    );
  }
  if (review === 'empty' || view.rows.length === 0) {
    return (
      <Card padding="none" data-engines="empty">
        <CardHeader title={title} />
        <EmptyState compact icon={<Server />} title={m('eng.empty')} />
      </Card>
    );
  }
  const stale = review === 'stale' || view.stale;
  const asOf = (
    <span className={styles.meta}>
      {m('asOf')}{' '}
      <span translate="no">
        {date(view.asOf, { locale })}, <bdi dir="ltr">{time(view.asOf)}</bdi>
      </span>
    </span>
  );
  const columns: AdminTableColumn[] = [
    { key: 'engine', header: m('eng.col.engine') },
    { key: 'mode', header: m('eng.col.status') },
    { key: 'model', header: m('eng.col.model'), hideBelow: 'md' },
    { key: 'calls', header: m('eng.col.calls'), align: 'end', hideBelow: 'md' },
    { key: 'fixture', header: m('eng.col.fixture'), align: 'end' },
    { key: 'last', header: m('eng.col.lastFail'), hideBelow: 'md' },
  ];
  const opened = open === undefined ? undefined : view.rows.find((row) => row.engine === open);
  return (
    <Card padding="none" data-engines={stale ? 'stale' : 'filled'}>
      <CardHeader
        title={title}
        actions={
          stale ? (
            <span className={styles.inline}>
              <StatusPill status={m('eng.stale')} tone="warning" size="sm" />
              {asOf}
            </span>
          ) : (
            asOf
          )
        }
      />
      <AdminTable caption={title} columns={columns} rows={view.rows.map((row) => engineRow(row, m, locale))} rowParam="engine" pageSize={0} />
      <EngineDrawer
        open={opened !== undefined}
        recordKey={opened?.engine}
        title={opened === undefined ? '' : m(`eng.${opened.engine}`)}
        subtitle={opened === undefined ? null : modePill(opened, m)}
        items={opened === undefined ? [] : drawerItems(opened, m, locale)}
      />
    </Card>
  );
}

/** Loading state and Suspense fallback. */
export async function EnginesLoading() {
  const m = await getTranslations('admin.system_health');
  return (
    <Card padding="none" data-engines="loading" aria-busy="true">
      <CardHeader title={m('eng.title')} />
      <div className={styles.skeletonBody}>
        <SkeletonText lines={4} announce />
      </div>
    </Card>
  );
}

function modePill(row: EngineRow, m: Translate): ReactNode {
  if (row.mode === 'fixture') return <StatusPill status={m('eng.mode.fixture')} tone="neutral" size="sm" />;
  const health = HEALTH[row.breaker];
  return <StatusPill status={m(`eng.hl.${health.key}`)} tone={health.tone} size="sm" />;
}

function stamp(iso: string | null, locale: 'en' | 'ar'): ReactNode {
  if (iso === null) return <span className={styles.muted}>{'—'}</span>;
  return (
    <span translate="no">
      <span className={styles.cellMain}>{date(iso, { locale })}</span>
      <span className={styles.cellSub}>{time(iso)}</span>
    </span>
  );
}

function engineRow(row: EngineRow, m: Translate, locale: 'en' | 'ar'): AdminTableRow {
  const breaker = row.mode === 'engine' ? row.breaker : 'closed';
  return {
    id: row.engine,
    label: m(`eng.${row.engine}`),
    tone: breaker === 'open' ? 'danger' : breaker === 'half_open' ? 'warning' : undefined,
    cells: {
      engine: <span className={styles.cellMain}>{m(`eng.${row.engine}`)}</span>,
      mode: modePill(row, m),
      model: row.modelVersion === null ? <span className={styles.muted}>{'—'}</span> : <span translate="no">{row.modelVersion}</span>,
      calls: (
        <span>
          <span className={styles.cellMain} translate="no">
            {num(row.calls, 0, locale)}
          </span>
          <span className={styles.cellSub}>{m('eng.sub', { f: num(row.failures, 0, locale), o: num(row.timeouts, 0, locale) })}</span>
        </span>
      ),
      fixture: (
        <strong translate="no" className={styles.strong}>
          {num(row.fixtureAnswers, 0, locale)}
        </strong>
      ),
      last: stamp(row.lastFailureAt, locale),
    },
  };
}

function drawerItems(row: EngineRow, m: Translate, locale: 'en' | 'ar'): { label: string; value: ReactNode }[] {
  const n = (value: number) => <span translate="no">{num(value, 0, locale)}</span>;
  const dash = '—';
  return [
    { label: m('eng.col.calls'), value: n(row.calls) },
    { label: m('eng.d.failed'), value: n(row.failures) },
    { label: m('eng.d.timeouts'), value: n(row.timeouts) },
    { label: m('eng.d.rejected'), value: n(row.rejected) },
    { label: m('eng.d.breaker'), value: row.mode === 'fixture' ? dash : m(`eng.brk.${row.breaker}`) },
    { label: m('eng.d.opens'), value: n(row.breakerOpens) },
    { label: m('eng.col.fixture'), value: n(row.fixtureAnswers) },
    { label: m('eng.d.model'), value: row.modelVersion === null ? dash : <span translate="no">{row.modelVersion}</span> },
    {
      label: m('eng.col.lastFail'),
      value:
        row.lastFailureAt === null ? (
          dash
        ) : (
          <span translate="no">
            {date(row.lastFailureAt, { locale })}, <bdi dir="ltr">{time(row.lastFailureAt)}</bdi>
          </span>
        ),
    },
  ];
}
