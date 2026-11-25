'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, ClipboardList, Pause, Play, Wifi, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { HandoverDrawer, type HandoverCardProps } from '@/components/opendispatch/assistant/HandoverCard';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { toggleOutage, toggleReplay } from './actions';
import type { ReplayView } from './types';

export interface HeaderActionsProps {
  readonly status: ReplayView['status'];
  /** True while the simulated feed outage is on. */
  readonly outageActive: boolean;
  readonly canEdit: boolean;
  /** The shift handover drawer's props; undefined hides the menu item. */
  readonly handover?: HandoverCardProps | undefined;
}

/** Pause or resume the replay (the one primary action) and More: shift handover, the simulated feed outage. */
export function HeaderActions({ status, outageActive, canEdit, handover }: HeaderActionsProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const t = useTranslations();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [handoverOpen, setHandoverOpen] = useState(false);

  const replayAction = useAdminAction(toggleReplay, { quiet: true });
  const outageAction = useAdminAction(toggleOutage, {
    successTitle: (state) => m(state.state === 'armed' ? 'toast.outageOff' : 'toast.outageOn'),
    successDescription: (state) => m(state.state === 'armed' ? 'toast.outageOffDesc' : 'toast.outageOnDesc'),
  });

  const playing = status === 'playing';
  const reason = gate.edit.reason;
  const items: MenuEntry[] = [
    ...(handover === undefined ? [] : [{ label: m('menu.handover'), icon: <ClipboardList />, onSelect: () => setHandoverOpen(true) }]),
    ...(reason === null ? [] : [{ type: 'heading', label: reason } as const]),
    {
      label: m(outageActive ? 'outage.off' : 'outage.on'),
      icon: outageActive ? <Wifi /> : <WifiOff />,
      disabled: reason !== null || outageAction.pending,
      onSelect: () => outageAction.run({ active: !outageActive }),
    },
  ];

  return (
    <>
      <ReasonHint reason={reason} visible={false}>
        <Button
          variant="primary"
          startIcon={playing ? <Pause /> : <Play />}
          loading={replayAction.pending}
          onClick={() => gate.edit.allowed && replayAction.run({ playing: !playing })}
        >
          {m(playing ? 'replay.pause' : 'replay.resume')}
        </Button>
      </ReasonHint>
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
      {handover === undefined ? null : <HandoverDrawer {...handover} open={handoverOpen} onClose={() => setHandoverOpen(false)} />}
      <ActionError error={outageAction.error} onDismiss={outageAction.reset} />
      <ActionError error={replayAction.error} onDismiss={replayAction.reset} />
    </>
  );
}
