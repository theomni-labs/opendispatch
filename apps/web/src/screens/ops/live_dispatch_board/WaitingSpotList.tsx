// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, EmptyState, Tag } from '@opendispatch/ui';
import { num } from '@opendispatch/ui/format';
import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { AdminTable } from '@/components/opendispatch/patterns/AdminTable';
import styles from './LiveDispatchBoard.module.css';
import type { WaitingSpotsView } from './types';

// Suggested waiting spots (#ldb-ws; the operator fallback rule)

export function WaitingSpotList({ waiting, locale }: { readonly waiting: WaitingSpotsView; readonly locale: string }) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  if (!waiting.enabled) return null;

  return (
    <Card padding="none">
      <div className={styles.mapHead}>
        <h2 id="ldb-ws-title" className={styles.cardTitle}>
          {m('ws.title')}
        </h2>
        <div className={styles.mapLegend}>
          <Badge tone="neutral" size="sm" dot>
            {m('ws.suggestion')}
          </Badge>
          {waiting.illustrative ? <IllustrativeLabel /> : null}
        </div>
      </div>
      {waiting.rows.length === 0 ? (
        <EmptyState compact icon={<MapPin />} title={m('ws.none.title')} description={m('ws.none.desc')} />
      ) : (
        <AdminTable
          caption={m('ws.title')}
          rowParam={false}
          pageSize={10}
          dense
          columns={[
            { key: 'agent', header: m('ws.col.agent') },
            { key: 'zone', header: t('common.zone') },
            { key: 'move', header: m('ws.col.move'), align: 'end' },
            { key: 'reason', header: m('ws.col.reason'), hideBelow: 'md' },
          ]}
          rows={waiting.rows.map((r) => ({
            id: r.agentId,
            label: r.name,
            cells: {
              agent: <span translate="no">{r.name}</span>,
              zone: (
                <Tag color="gray">
                  <span translate="no">{r.zoneCode}</span>
                </Tag>
              ),
              move: <span translate="no">{m('ws.km', { n: num(r.moveKm, 1, locale) })}</span>,
              reason: m(`ws.reasons.${r.reason}`),
            },
          }))}
        />
      )}
    </Card>
  );
}
