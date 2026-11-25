// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, CardHeader, DescriptionList, EmptyState, Stat, StatusPill, type Tone } from '@opendispatch/ui';
import { date, num, time } from '@opendispatch/ui/format';
import { Activity, Ban, Check, ChevronRight, Lock, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import styles from './AiAssistant.module.css';
import { AssistantHeader, RefreshButton } from './AssistantForms';
import type { AssistantStatusValue, AssistantView, LastTest, UsageRow } from './types';
import { loadAssistantView } from './view';

// Admin 18; mockup admin-ai-assistant.html

type Translate = Awaited<ReturnType<typeof getTranslations>>;
type Locale = 'en' | 'ar';

const STATUS_TONE: Readonly<Record<AssistantStatusValue, Tone>> = { on: 'success', off: 'neutral', not_configured: 'warning' };
const SENT = ['data.sent1', 'data.sent2', 'data.sent3'] as const;
const NEVER = ['data.never1', 'data.never2', 'data.never3'] as const;

export async function AiAssistantScreen({ def, ctx, access, homeHref, locale: pageLocale, state }: ScreenProps) {
  const m = await getTranslations('admin.ai_assistant');
  const locale: Locale = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<AssistantHeader canEdit={canEdit} offReason={null} />} emptyAction={<RefreshButton />} />;
  }

  const view = await loadAssistantView(ctx);
  const offReason = view.status === 'on' ? null : m(view.status === 'off' ? 'test.reasonOff' : 'test.reasonKey');

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} actions={<AssistantHeader canEdit={canEdit} offReason={offReason} />}>
      <div className={styles.stack}>
        <div className={styles.stats}>
          <Stat label={m('stat.status')} icon={<Sparkles />} value={<StatusPill status={m(`status.${view.status}`)} tone={STATUS_TONE[view.status]} />} />
          <Stat
            label={m('stat.provider')}
            value={m(`provider.${view.provider}`)}
            hint={
              <span translate="no" data-model="">
                {view.model === '' ? '-' : view.model}
              </span>
            }
          />
          <Stat label={m('stat.calls')} value={<bdi translate="no">{num(view.calls, 0, locale)}</bdi>} />
          <Stat label={m('stat.success')} value={<bdi translate="no">{view.successPct === null ? '-' : `${num(view.successPct, 0, locale)}%`}</bdi>} />
        </div>
        <div className={styles.detailGrid}>
          <div className={styles.col}>
            <Card padding="none">
              <CardHeader
                title={m('usage.title')}
                actions={
                  <Button variant="link" size="sm" href="/admin/audit-log" endIcon={<ChevronRight />}>
                    {m('usage.audit')}
                  </Button>
                }
              />
              {view.usage.length === 0 ? (
                <EmptyState compact icon={<Activity />} title={m(view.status === 'on' ? 'usage.empty' : 'usage.emptyOff')} />
              ) : (
                <AdminTable caption={m('usage.title')} columns={usageColumns(m)} rows={view.usage.map((row) => usageRow(row, m, locale))} rowParam={false} pageSize={0} />
              )}
            </Card>
          </div>
          <aside className={styles.col}>
            <Card padding="lg">
              <div className={styles.stack}>
                <h2 className={styles.sectionTitle}>{m('cfg.title')}</h2>
                <DescriptionList
                  dense
                  columns={1}
                  items={[
                    { label: m('stat.provider'), value: m(`provider.${view.provider}`) },
                    { label: m('cfg.model'), value: <span translate="no">{view.model === '' ? '-' : view.model}</span> },
                    { label: m('cfg.offline'), value: m(view.offline ? 'yes' : 'no') },
                    { label: m('cfg.key'), value: keyValue(view, m) },
                    { label: m('cfg.lastTest'), value: lastTestValue(view.status === 'on' ? view.lastTest : null, m, locale) },
                  ]}
                />
                <p className={styles.meta}>
                  {m('cfg.where')}{' '}
                  <bdi dir="ltr" translate="no">
                    OPENDISPATCH_ASSISTANT_*
                  </bdi>
                </p>
              </div>
            </Card>
            <Card padding="lg">
              <div className={styles.stack}>
                <h2 className={styles.sectionTitle}>{m('data.title')}</h2>
                <div className={styles.group}>
                  <span className={styles.label}>{m('data.sent')}</span>
                  <ul className={styles.facts}>
                    {SENT.map((key) => (
                      <li key={key}>
                        <Check aria-hidden="true" size={16} />
                        <span>{m(key)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={styles.group}>
                  <span className={styles.label}>{m('data.never')}</span>
                  <ul className={styles.facts}>
                    {NEVER.map((key) => (
                      <li key={key}>
                        <Ban aria-hidden="true" size={16} />
                        <span>{m(key)}</span>
                      </li>
                    ))}
                    <li>
                      <Lock aria-hidden="true" size={16} />
                      <span>{m('data.never4')}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </ScreenFrame>
  );
}

function usageColumns(m: Translate): AdminTableColumn[] {
  return [
    { key: 'feature', header: m('col.feature') },
    { key: 'calls', header: m('col.calls'), align: 'end' },
    { key: 'succeeded', header: m('col.succeeded'), align: 'end' },
    { key: 'rejected', header: m('col.rejected'), align: 'end', hideBelow: 'md' },
    { key: 'retried', header: m('col.retried'), align: 'end', hideBelow: 'md' },
    { key: 'median', header: m('col.median'), align: 'end' },
    { key: 'p90', header: m('col.p90'), align: 'end', hideBelow: 'md' },
  ];
}

const dash = <span className={styles.muted}>-</span>;

function count(n: number | null, locale: Locale): ReactNode {
  return n === null ? dash : <bdi translate="no">{num(n, 0, locale)}</bdi>;
}

function seconds(ms: number | null, m: Translate, locale: Locale): ReactNode {
  return ms === null ? dash : <bdi dir="ltr" translate="no">{`${num(ms / 1000, 1, locale)} ${m('unit.s')}`}</bdi>;
}

function usageRow(row: UsageRow, m: Translate, locale: Locale): AdminTableRow {
  return {
    id: row.feature,
    label: m(`feature.${row.feature}`),
    cells: {
      feature: <span className={styles.cellMain}>{m(`feature.${row.feature}`)}</span>,
      calls: count(row.calls, locale),
      succeeded: count(row.successes, locale),
      rejected: count(row.rejected, locale),
      retried: row.retried === null ? dash : <bdi dir="ltr" translate="no">{`${num(row.retried, 0, locale)} · ${num(row.fallbacks ?? 0, 0, locale)}`}</bdi>,
      median: seconds(row.medianMs, m, locale),
      p90: seconds(row.p90Ms, m, locale),
    },
  };
}

function keyValue(view: AssistantView, m: Translate): ReactNode {
  if (view.key === 'not_needed') return m('key.not_needed');
  return <StatusPill status={m(`key.${view.key}`)} tone={view.key === 'configured' ? 'success' : 'warning'} size="sm" />;
}

function lastTestValue(test: LastTest | null, m: Translate, locale: Locale): ReactNode {
  if (test === null) return dash;
  const when = (
    <span translate="no">
      {date(test.testedAt, { locale })}, <bdi dir="ltr">{time(test.testedAt)}</bdi>
    </span>
  );
  return (
    <span className={styles.testValue} data-last-test={test.ok ? 'ok' : 'failed'}>
      <span>
        <StatusPill status={m(test.ok ? 'test.ok' : 'test.failed')} tone={test.ok ? 'success' : 'danger'} size="sm" />
      </span>
      <span className={styles.meta}>
        {test.ok ? <bdi dir="ltr" translate="no">{`${num(test.durationMs / 1000, 1, locale)} ${m('unit.s')}`}</bdi> : m(`err.${test.errorCode ?? 'provider_error'}`)} · {when}
      </span>
    </span>
  );
}
