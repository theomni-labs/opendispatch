'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, DescriptionList, Drawer, Tabs, Timeline, type TimelineItem } from '@opendispatch/ui';
import { int } from '@opendispatch/ui/format';
import { ArrowLeftRight, Check, Clock, Eye } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { CaseAiLink } from '@/components/opendispatch/assistant/CaseAiLink';
import { PickName, PROGRESS_TONE, SOURCE_TONE, useEtaText, type CaseProgress } from '@/components/opendispatch/LiveCaseCard';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { StageChip } from '@/components/opendispatch/StageChip';
import styles from './CaseDrawer.module.css';
import type { CaseCardView } from './types';

// The case drawer (#ldb-case): what a slim card leaves out

export interface CaseDrawerProps {
  /** The open case; null closes the drawer. */
  readonly target: CaseCardView | null;
  /** Its state on the board: waiting, recommended, or in progress. */
  readonly progress: CaseProgress | undefined;
  readonly onClose: () => void;
  readonly onAccept: () => void;
  readonly onOverride: () => void;
  /** Opens the Suggested by AI drawer (`?ai=`). */
  readonly onAi: () => void;
  readonly disabledReason: string | null;
}

type Tab = 'details' | 'history';

export function CaseDrawer({ target, progress, onClose, onAccept, onOverride, onAi, disabledReason }: CaseDrawerProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const [tab, setTab] = useState<Tab>('details');
  const close = () => {
    setTab('details');
    onClose();
  };
  return (
    <Drawer
      open={target !== null}
      onClose={close}
      title={target === null ? '' : <span translate="no">{target.caseNumber}</span>}
      subtitle={target === null ? undefined : `${target.zoneCode} · ${t('opendispatch.dispatch.parties', { count: target.parties })}`}
      footer={
        <Button variant="ghost" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {target === null ? null : (
        <div className={styles.body} data-case-drawer={target.caseId}>
          <Tabs
            ariaLabel={target.caseNumber}
            value={tab}
            onChange={(v) => setTab(v === 'history' ? 'history' : 'details')}
            items={[
              { value: 'details', label: m('case.details') },
              { value: 'history', label: m('case.history') },
            ]}
          />
          {tab === 'details' ? (
            <Details target={target} progress={progress} onAccept={onAccept} onOverride={onOverride} onAi={onAi} disabledReason={disabledReason} />
          ) : (
            <Timeline items={historyOf(target, progress, m, t)} />
          )}
        </div>
      )}
    </Drawer>
  );
}

function Details({ target, progress, onAccept, onOverride, onAi, disabledReason }: Omit<CaseDrawerProps, 'target' | 'onClose'> & { readonly target: CaseCardView }) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const locale = useLocale();
  const etaText = useEtaText();
  const waiting = target.waitMinutes !== undefined;
  const state = waiting ? 'waiting' : progress ?? 'recommended';
  const pickLabel = target.pick?.label === 'opendispatch_would_pick' ? t('opendispatch.dispatch.pickWould') : target.pick?.label === 'opendispatch_pick' ? t('opendispatch.dispatch.pickOpenDispatch') : m('case.agent');
  const note: ReactNode =
    target.reason?.kind === 'waiting_customer' ? (
      <Reason icon={<Clock />}>{t('opendispatch.dispatch.waitingCustomer')}</Reason>
    ) : target.reason?.kind === 'reassigned_from' ? (
      <Reason icon={<ArrowLeftRight />}>
        {t('opendispatch.dispatch.reassignedFrom')} <span translate="no">{target.reason.name}</span>
      </Reason>
    ) : target.reason?.kind === 'would_pick' ? (
      <Reason icon={<Eye />}>
        {t('opendispatch.dispatch.pickWould')}: <span translate="no">{target.reason.name}</span> ·{' '}
        <span dir="ltr" translate="no">
          {int(target.reason.minutes, locale)} {t('common.minShort')}
        </span>
      </Reason>
    ) : null;
  const cls = target.classification;
  const handling = cls === undefined ? '—' : (
    <span>
      {t(`opendispatch.dispatch.class.${cls.handling}`)} <Qualifier />
    </span>
  );
  const rule = cls === undefined ? '—' : cls.source === 'feed' ? t('opendispatch.dispatch.class.feed') : cls.rule === null ? t('opendispatch.dispatch.class.default') : <bdi translate="no">{cls.rule}</bdi>;

  return (
    <div className={styles.body}>
      <div className={styles.status}>
        <Badge tone={state === 'waiting' ? 'warning' : state === 'recommended' ? 'info' : PROGRESS_TONE[state]} dot size="sm">
          {t(`opendispatch.dispatch.state.${state}`)}
        </Badge>
        {target.pick?.source === undefined ? null : (
          <Badge tone={SOURCE_TONE[target.pick.source]} size="sm">
            {t(`opendispatch.dispatch.source.${target.pick.source}`)}
          </Badge>
        )}
        {target.overReach === true ? (
          <Badge tone="danger" dot size="sm">
            {t('opendispatch.dispatch.overReach')}
          </Badge>
        ) : null}
      </div>
      {target.pick === undefined ? null : (
        <Card padding="md">
          <div className={styles.rec}>
            <span className={styles.label}>{pickLabel}</span>
            <div className={styles.pick}>
              <span className={styles.name}>
                <PickName name={target.pick.name} />
              </span>
              <span className={styles.eta} translate="no">
                {etaText(target.eta)}
              </span>
            </div>
            {note}
            {target.canDecide ? (
              <div className={styles.actions}>
                <ReasonHint reason={disabledReason} visible={false}>
                  <Button variant="primary" size="sm" startIcon={<Check />} onClick={onAccept} className={styles.action}>
                    {t('opendispatch.dispatch.accept')}
                  </Button>
                </ReasonHint>
                <ReasonHint reason={disabledReason} visible={false}>
                  <Button variant="secondary" size="sm" startIcon={<ArrowLeftRight />} onClick={onOverride} className={styles.action}>
                    {t('opendispatch.dispatch.override')}
                  </Button>
                </ReasonHint>
              </div>
            ) : null}
          </div>
        </Card>
      )}
      <DescriptionList
        dense
        columns={1}
        items={[
          { label: m('case.registered'), value: <span translate="no">{target.time}</span> },
          { label: m('case.parties'), value: t('opendispatch.dispatch.parties', { count: target.parties }) },
          { label: m('case.stage'), value: <StageChip zone={target.zoneCode} stage={target.stage} /> },
          { label: m('case.handling'), value: handling },
          { label: m('case.rule'), value: rule },
        ]}
      />
      <div>
        <CaseAiLink summary={target.ai} onOpen={onAi} />
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations>;

/** @pure History from the board's own fields, newest first. */
export function historyOf(c: CaseCardView, progress: CaseProgress | undefined, m: Translate, t: Translate): TimelineItem[] {
  const items: TimelineItem[] = [{ id: 'registered', title: m('case.h.registered'), time: c.time, description: c.zoneCode, tone: 'neutral' }];
  if (c.waitMinutes !== undefined) items.push({ id: 'waiting', title: m('case.h.waiting'), tone: 'warning' });
  if (c.canDecide && c.pick) items.push({ id: 'recommended', title: m('case.h.recommended'), description: c.pick.name ?? '—', tone: 'info' });
  if (progress !== undefined && c.pick) {
    const source = c.pick.source === undefined ? '' : ` · ${t(`opendispatch.dispatch.source.${c.pick.source}`)}`;
    items.push({ id: 'assigned', title: m('case.h.assigned'), description: `${c.pick.name ?? '—'}${source}`, tone: 'neutral' });
  }
  if (c.reason?.kind === 'reassigned_from') items.push({ id: 'overridden', title: m('case.h.overridden'), description: c.reason.name, tone: 'info' });
  if (progress === 'enroute' || progress === 'onscene') items.push({ id: 'enroute', title: m('case.h.enroute'), tone: 'info' });
  if (progress === 'onscene') items.push({ id: 'arrived', title: m('case.h.arrived'), ...(c.eta?.kind === 'arrived' ? { time: c.eta.time } : {}), tone: 'success' });
  return items.reverse();
}
