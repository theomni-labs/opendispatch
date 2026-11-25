// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, EmptyState, Tag } from '@opendispatch/ui';
import { date } from '@opendispatch/ui/format';
import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { AdminTable } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import styles from './LiveDispatchBoard.module.css';
import type { UnmetView } from './types';

// Cases out of 10-minute reach (#ldb-ur)

const CAUSE_COLOR = { geography: 'green', people: 'geekblue' } as const;

export function UnmetLog({ unmet, locale }: { readonly unmet: UnmetView; readonly locale: string }) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const dash = <span className={styles.muted}>—</span>;

  return (
    <Card padding="none">
      <div className={styles.mapHead}>
        <h2 id="ldb-ur-title" className={styles.cardTitle}>
          {m('ur.title')}
        </h2>
        <div className={styles.mapLegend}>
          <Badge tone="danger" size="sm">
            <span translate="no">{unmet.rows.length}</span>
          </Badge>
          <IllustrativeLabel />
        </div>
      </div>
      <ListToolbar
        searchParam={false}
        filters={[
          { key: 'ur_zone', label: t('common.zone'), options: unmet.zoneOptions },
          { key: 'ur_day', label: m('ur.day'), options: unmet.dayOptions.map((d) => ({ value: d, label: date(d, { locale }) })) },
          { key: 'ur_cause', label: m('ur.cause'), options: [{ value: 'geography', label: m('ur.causes.geography') }, { value: 'people', label: m('ur.causes.people') }] },
        ]}
      />
      {unmet.rows.length === 0 ? (
        <EmptyState compact icon={<CircleCheck />} title={m('ur.none.title')} description={m('ur.none.desc', { min: unmet.thresholdMinutes })} />
      ) : (
        <AdminTable
          caption={m('ur.title')}
          rowParam={false}
          pageSize={10}
          dense
          columns={[
            { key: 'case', header: m('ur.col.case') },
            { key: 'zone', header: t('common.zone') },
            { key: 'time', header: m('ur.col.time'), hideBelow: 'md' },
            { key: 'nearest', header: m('ur.col.nearest'), hideBelow: 'md' },
            { key: 'travel', header: m('ur.col.travel'), align: 'end' },
            { key: 'cause', header: m('ur.cause') },
          ]}
          rows={unmet.rows.map((r) => ({
            id: r.caseId,
            label: r.caseNumber,
            cells: {
              case: <span translate="no">{r.caseNumber}</span>,
              zone: (
                <Tag color="gray">
                  <span translate="no">{r.zoneCode}</span>
                </Tag>
              ),
              time: (
                <span translate="no" dir="ltr">
                  {r.time}
                </span>
              ),
              nearest: r.nearestName === null ? dash : <span translate="no">{r.nearestName}</span>,
              travel: r.travelMinutes === null ? dash : <span translate="no">{m('ur.minutes', { n: r.travelMinutes })}</span>,
              cause: <Tag color={CAUSE_COLOR[r.cause]}>{m(`ur.causes.${r.cause}`)}</Tag>,
            },
          }))}
        />
      )}
    </Card>
  );
}
