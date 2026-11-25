'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DescriptionList, Drawer, IconButton, Stack, StatusPill } from '@opendispatch/ui';
import { time } from '@opendispatch/ui/format';
import { Check, ChevronLeft, ChevronRight, Circle, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { updateBreakSlotAction } from './actions';
import { GRID, heldPrayerOf, overlapMinutesOf, prayerConflictOf, type BreakPrayerPolicy, type PrayerMinute } from './types';
import type { BreakRowView } from './view';
import styles from './BreakPlanner.module.css';
import mirror from '@/components/opendispatch/mirror.module.css';

// Adjust one break (#bp-drawer)

export interface AdjustDrawerProps {
  readonly target: BreakRowView | undefined;
  readonly date: string;
  readonly prayers: readonly PrayerMinute[];
  readonly policy: BreakPrayerPolicy;
  readonly disabledReason: string | null;
}

export function AdjustDrawer({ target, date, prayers, policy, disabledReason }: AdjustDrawerProps) {
  const m = useTranslations('ops.break_planner');
  const t = useTranslations();
  const url = useUrlState();

  const [openId, setOpenId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState(0);

  const key = target?.assignmentId ?? null;
  if (key !== openId) {
    setOpenId(key);
    setCandidate(target?.startMin ?? 0);
  }

  const close = () => url.update({ adjust: null });
  const save = useAdminAction(updateBreakSlotAction, {
    successTitle: m('toast.moved'),
    successDescription: target === undefined ? undefined : m('toast.movedDesc', { name: target.agentName, time: time(candidate) }),
    onSuccess: close,
  });

  if (target === undefined) return <Drawer open={false} onClose={close} title={m('adj.title')} />;

  const conflict = prayerConflictOf(candidate, candidate + target.durationMin, prayers, policy);
  const held = conflict === null ? heldPrayerOf(candidate, candidate + target.durationMin, prayers, policy) : null;
  const statusTone = conflict !== null ? 'danger' : held !== null ? 'success' : 'neutral';
  const statusIcon = conflict !== null ? <TriangleAlert /> : held !== null ? <Check /> : <Circle />;
  const statusLabel =
    conflict !== null
      ? m('adj.cuts', { p: m(`prayer.${conflict}`), min: overlapMinutesOf(candidate, candidate + target.durationMin, prayers, policy) })
      : held !== null
        ? m('adj.holds', { p: m(`prayer.${held}`) })
        : m('adj.clear');

  const atFirst = candidate <= target.earliestMin;
  const atLast = candidate >= target.latestMin;
  const step = (delta: number) => setCandidate((value) => Math.min(target.latestMin, Math.max(target.earliestMin, value + delta)));

  return (
    <Drawer
      open
      onClose={close}
      title={m('adj.title')}
      subtitle={
        <span dir="ltr" translate="no">
          {target.agentName} · {target.agentCode}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={disabledReason} visible={false}>
            <Button variant="primary" loading={save.pending} onClick={() => save.run({ rosterAssignmentId: target.assignmentId, date, startMin: candidate })}>
              {t('common.save')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={20}>
        <DescriptionList
          dense
          items={[
            { label: m('col.shift'), value: <span translate="no">{target.shiftLabel}</span> },
            {
              label: m('adj.window'),
              value: (
                <span dir="ltr" translate="no">
                  {time(target.earliestMin)}–{time(target.latestMin)}
                </span>
              ),
            },
          ]}
        />
        <div className={styles.stepRow}>
          <IconButton variant="secondary" icon={<ChevronLeft className={mirror.mirror} />} label={m('adj.earlier')} disabled={atFirst || disabledReason !== null} onClick={() => step(-GRID)} />
          <span className={styles.stepTime} dir="ltr" translate="no">
            {time(candidate)}–{time(candidate + target.durationMin)}
          </span>
          <IconButton variant="secondary" icon={<ChevronRight className={mirror.mirror} />} label={m('adj.later')} disabled={atLast || disabledReason !== null} onClick={() => step(GRID)} />
        </div>
        <span className={styles.statusRow}>
          <span aria-hidden="true">{statusIcon}</span>
          <StatusPill status={statusLabel} tone={statusTone} />
        </span>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </Drawer>
  );
}
