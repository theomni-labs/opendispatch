'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DescriptionList, Drawer, StatusPill, Tag, type Tone } from '@opendispatch/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import styles from './GapSurplus.module.css';
import { detailKeyOf } from './types';
import type { DrawerDetail } from './view';

// Cell detail (#gs-drawer), read only

const KIND_TONE: Readonly<Record<DrawerDetail['kind'], Tone>> = { gap: 'danger', surplus: 'info', balanced: 'neutral' };
const CAUSE_COLOR = { people: 'geekblue', vehicles: 'gold', geography: 'green' } as const;

export interface CellDrawerProps {
  readonly target: DrawerDetail | undefined;
}

export function CellDrawer({ target }: CellDrawerProps) {
  const m = useTranslations('ops.gap_surplus');
  const t = useTranslations();
  const url = useUrlState();

  const close = () => url.update({ cell: null });

  return (
    <Drawer
      open={target !== undefined}
      onClose={close}
      title={target?.zoneName ?? ''}
      subtitle={target === undefined ? undefined : <span dir="ltr" translate="no">{target.rangeLabel}</span>}
      footer={
        target?.linkHref === null || target === undefined ? null : (
          <Button variant="secondary" href={target.linkHref}>
            {t(target.linkIsStandby ? 'nav.ops.standby_coverage.menu' : 'nav.ops.field_planner.menu')}
          </Button>
        )
      }
    >
      {target === undefined ? null : (
        <div className={styles.drawerStack}>
          <div className={styles.drawerPillRow}>
            <StatusPill status={m(`kind.${target.kind}`)} tone={KIND_TONE[target.kind]} size="sm" />
            <IllustrativeLabel />
          </div>
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: m('d.required'), value: <span translate="no">{target.required}</span> },
              { label: m('d.planned'), value: <span translate="no">{target.planned}</span> },
              { label: m('d.delta'), value: <span translate="no">{target.delta > 0 ? `+${target.delta}` : target.delta}</span> },
              { label: m('d.cause'), value: target.cause === null ? null : <Tag color={CAUSE_COLOR[target.cause]}>{m(`cause.${target.cause}`)}</Tag> },
              { label: m('d.met'), value: <span translate="no">{m('d.metOf', { pct: target.metLabel, planned: Math.min(target.planned, target.required), required: target.required })}</span> },
              ...(target.outLabel === null ? [] : [{ label: m('d.out'), value: <span translate="no">{target.outLabel}</span> }]),
              ...(target.reachLabel === null
                ? []
                : [
                    {
                      label: m('d.reach'),
                      value: <span translate="no">{target.targetLabel === null ? target.reachLabel : m('d.reachOf', { pct: target.reachLabel, target: target.targetLabel })}</span>,
                    },
                  ]),
              ...(target.basis === null
                ? []
                : [
                    {
                      label: m('d.basis'),
                      value:
                        target.basis.method === 'rate_convention'
                          ? m('d.basisCustomer', { n: target.basis.casesPerInterval })
                          : m('d.basisDuration', { min: target.basis.minutes, travel: target.basis.travel, scene: target.basis.onScene, admin: target.basis.admin }),
                    },
                  ]),
            ]}
          />
          <p className={styles.drawerDetail}>
            <Info aria-hidden="true" size={16} />
            <span>{m(detailKeyOf(target.kind, target.cause), { n: Math.abs(target.delta) })}</span>
          </p>
        </div>
      )}
    </Drawer>
  );
}
