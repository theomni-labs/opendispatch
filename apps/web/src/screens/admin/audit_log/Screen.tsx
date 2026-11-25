// SPDX-License-Identifier: AGPL-3.0-only
import { Avatar, Badge, Card } from '@opendispatch/ui';
import { date, time } from '@opendispatch/ui/format';
import { Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { AdminTableColumn, AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import styles from './AuditLog.module.css';
import { AuditDrawer, AuditHeader, OutcomePill } from './AuditForms';
import { AuditTable } from './AuditTables';
import { AUDIT_CATEGORIES, AUDIT_PERIODS, type AuditRow } from './types';
import { loadAuditView, PAGE_SIZE } from './view';

// Audit Log. A Server Component: it reads through lib/data with the request context ModuleRoute built
// and passes plain data to the client files. Search, filters, page and the open event live in the address (?q= ?outcome= ?cat=
// ?period= ?page= ?id=); each is checked here against an allow-list. The log is append only, so every role that can open it
// (Administrator, Viewer / Auditor and, in private installs, Change Approver) sees the same page: read only, Export enabled.
// The Summary column is the data layer's English text, marked lang="en" (the events are written in English). Names of
// the actors come from `listUserDisplayNames`. `?state=empty|loading|error` (demo-mode review hook) shows those states without
// reading data.

const first = (value: string | readonly string[] | undefined): string | undefined => (typeof value === 'string' ? value : value?.[0]);

type Translate = Awaited<ReturnType<typeof getTranslations>>;

export async function AuditLogScreen({ def, access, ctx, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.audit_log');
  const t = await getTranslations();
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const meta = (
    <Badge icon={<Lock />}>
      {m('appendOnly')}
    </Badge>
  );

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} meta={meta} description={m('sub')} actions={<AuditHeader disabled />} />;
  }

  const query = parseSearchParams(searchParams, {
    q: param.text(80),
    outcome: param.enum(['success', 'denied']),
    cat: param.enum(AUDIT_CATEGORIES),
    period: param.enum(AUDIT_PERIODS),
    page: param.int(1, 100_000),
    id: param.id(),
  });
  const view = await loadAuditView(ctx, query, first(searchParams['id']));

  const columns: AdminTableColumn[] = [
    { key: 'time', header: m('col.time') },
    { key: 'actor', header: m('col.actor') },
    { key: 'action', header: m('col.action') },
    { key: 'entity', header: m('col.entity'), hideBelow: 'md' },
    { key: 'summary', header: m('col.summary') },
    { key: 'outcome', header: m('col.outcome') },
    { key: 'source', header: m('col.source'), hideBelow: 'lg' },
  ];
  const rows = view.rows.map((row) => tableRow(row, m, t, locale));

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      meta={meta}
      description={m('sub')}
      sources={view.sources}
      isEmpty={view.total === 0}
      actions={<AuditHeader />}
    >
      <div className={styles.stack}>
        {view.unknownId ? <RecordNotice message={m('notice.notFound')} /> : null}
        <StatStrip
          items={[
            { label: m('stat.events'), value: view.counts.all },
            { label: m('stat.24h'), value: view.counts.last24h },
            { label: m('stat.signins'), value: view.counts.signIns },
            { label: m('stat.denied'), value: view.counts.denied },
          ]}
        />
        <Card padding="none">
          <ListToolbar
            searchLabel={m('search')}
            filters={[
              { key: 'outcome', label: m('col.outcome'), options: [{ value: 'success', label: m('out.success') }, { value: 'denied', label: m('out.denied') }] },
              { key: 'cat', label: m('f.cat'), options: AUDIT_CATEGORIES.map((category) => ({ value: category, label: m(`cat.${category}`) })) },
              { key: 'period', label: m('f.period'), options: [{ value: '24h', label: m('stat.24h') }, { value: '7d', label: m('per.7d') }] },
            ]}
          />
          <AuditTable
            caption={t('nav.admin.audit_log.title')}
            columns={columns}
            rows={rows}
            emptyState={<NoMatch title={m('nomatch')} clearParams={['q', 'outcome', 'cat', 'period']} />}
            page={view.page}
            pageCount={view.pageCount}
            total={view.matching}
            pageSize={PAGE_SIZE}
          />
        </Card>
      </div>
      <AuditDrawer open={view.open} />
    </ScreenFrame>
  );
}

function actorCell(row: AuditRow, m: Translate, t: Translate): ReactNode {
  if (row.actorName !== null) {
    const sub = [...(row.actorRole === null ? [] : [t(`roles.${row.actorRole}`)]), ...(row.actorType === 'emergency_admin' ? [m('local')] : [])].join(' · ');
    return (
      <span className={styles.actor}>
        <span translate="no">
          <Avatar name={row.actorName} size="xs" />
        </span>
        <span>
          <span className={styles.cellMain} translate="no">
            {row.actorName}
          </span>
          {sub === '' ? null : <span className={styles.cellSub}>{sub}</span>}
        </span>
      </span>
    );
  }
  const system = row.actorType === 'system' || row.actorType === 'demo';
  return (
    <span>
      <span className={styles.cellMain}>{m(system ? 'actor.system.label' : 'actor.unknown.label')}</span>
      <span className={styles.cellSub}>{m(row.actorType === 'demo' ? 'actor.demo.sub' : system ? 'actor.system.sub' : 'actor.unknown.sub')}</span>
    </span>
  );
}

/** The message key of an action's label: dots are not allowed in a key, so `rule.approved` is `act.rule__approved`. */
function actionKey(action: string): string {
  return `act.${action.replaceAll('.', '__')}`;
}

/** The Arabic summary: the filled sentence, else the label. */
function arabicSummary(row: AuditRow, m: Translate): string | null {
  const sentence = `sum.${row.action.replaceAll('.', '__')}`;
  if (row.summaryParams !== null && m.has(sentence)) return m(sentence, { ...row.summaryParams });
  return m.has(actionKey(row.action)) ? m(actionKey(row.action)) : null;
}

function tableRow(row: AuditRow, m: Translate, t: Translate, locale: 'en' | 'ar'): AdminTableRow {
  const arabic = locale === 'ar' ? arabicSummary(row, m) : null;
  return {
    id: row.id,
    label: row.action,
    tone: row.outcome === 'denied' ? 'danger' : undefined,
    cells: {
      time: (
        <span translate="no">
          <span className={styles.cellMain}>{date(row.occurredAt, { locale })}</span>
          <span className={styles.cellSub}>{time(row.occurredAt)}</span>
        </span>
      ),
      actor: actorCell(row, m, t),
      action: (
        <span className={styles.cellMain} translate="no">
          {row.action}
        </span>
      ),
      entity: (
        <span translate="no">
          <span className={styles.cellMain}>{row.entityType}</span>
          {row.entityLabel === null ? null : <span className={styles.cellSub}>{row.entityLabel}</span>}
        </span>
      ),
      summary:
        arabic !== null ? (
          <span className={styles.summary}>{arabic}</span>
        ) : (
          <span className={styles.summary} lang="en" dir="ltr" translate="no">
            {row.summary}
          </span>
        ),
      outcome: <OutcomePill outcome={row.outcome} />,
      source: m(`src.${row.source}`),
    },
  };
}
