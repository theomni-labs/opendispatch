'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, CountBadge, useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { LiveCaseCard, type CaseProgress } from '@/components/opendispatch/LiveCaseCard';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useGate } from '@/components/opendispatch/ReasonHint';
import { accept, override } from './actions';
import { CaseDrawer } from './CaseDrawer';
import { refusalOf } from './refusal';
import { OverrideDrawer, type ReasonOption } from './OverrideDrawer';
import type { BoardColumn, CaseCardView, DisplayColumn } from './types';
import { DISPLAY_COLUMNS, PROGRESS_STATES } from './types';
import styles from './Board.module.css';

/** Cards shown per column before "Show N more". */
export const COLUMN_CAP = 6;

export interface BoardProps {
  readonly columns: Readonly<Record<BoardColumn, readonly CaseCardView[]>>;
  readonly columnLabels: Readonly<Record<DisplayColumn, string>>;
  readonly emptyText: string;
  readonly canEdit: boolean;
  readonly reasonOptions: readonly ReasonOption[];
}

interface Placed {
  readonly card: CaseCardView;
  readonly progress: CaseProgress | undefined;
}

/** @pure The three drawn columns; In progress keeps each state. */
export function displayColumns(columns: BoardProps['columns']): Record<DisplayColumn, Placed[]> {
  return {
    waiting: columns.waiting.map((card) => ({ card, progress: undefined })),
    recommended: columns.recommended.map((card) => ({ card, progress: undefined })),
    progress: PROGRESS_STATES.flatMap((state) => columns[state].map((card) => ({ card, progress: state }))),
  };
}

export function Board({ columns, columnLabels, emptyText, canEdit, reasonOptions }: BoardProps) {
  const m = useTranslations('ops.live_dispatch_board');
  const tAction = useTranslations('patterns.action');
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const [overriding, setOverriding] = useState<CaseCardView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Partial<Record<DisplayColumn, boolean>>>({});
  // Toast text, set before, read once it settles.
  const pendingName = useRef<string>('');
  const pendingReason = useRef<string>('');

  const shown = displayColumns(columns);
  const opened = openId === null ? undefined : Object.values(shown).flat().find((p) => p.card.caseId === openId);

  // A refusal shows where Accept was pressed
  const acceptAction = useAdminAction(accept, {
    successTitle: () => m('toast.assigned', { name: pendingName.current }),
    onSuccess: () => setOpenId(null),
    onFailure: (failure) => {
      const refusal = refusalOf(failure);
      toast({
        title: refusal.plain === 'taken' ? m('toast.taken') : tAction(`error.${failure.code}`),
        ...(refusal.detail === '' ? {} : { description: <span lang="en" dir="ltr" translate="no">{refusal.detail}</span> }),
        tone: refusal.plain === 'taken' ? 'warning' : 'danger',
      });
    },
  });
  const overrideAction = useAdminAction(override, {
    successTitle: () => m('toast.reassigned', { name: pendingName.current }),
    successDescription: () => m('toast.reason', { reason: pendingReason.current }),
    onSuccess: () => setOverriding(null),
  });

  const runAccept = (card: CaseCardView) => {
    if (!gate.edit.allowed || card.recommendedAgentId === undefined) return;
    pendingName.current = card.pick?.name ?? '';
    acceptAction.run({ caseId: card.caseId, agentId: card.recommendedAgentId });
  };
  const openOverride = (card: CaseCardView) => {
    if (!gate.edit.allowed) return;
    overrideAction.reset();
    setOpenId(null);
    setOverriding(card);
  };

  return (
    <>
      <div className={styles.board}>
        {DISPLAY_COLUMNS.map((column) => {
          const placed = shown[column];
          const visible = expanded[column] === true ? placed : placed.slice(0, COLUMN_CAP);
          return (
            <section key={column} className={styles.column} aria-labelledby={`ldb-col-${column}`} data-column={column}>
              <header className={styles.head}>
                <h3 id={`ldb-col-${column}`} className={styles.title}>
                  {columnLabels[column]}
                </h3>
                <CountBadge count={placed.length} />
              </header>
              <div className={styles.body}>
                {placed.length === 0 ? (
                  <p className={styles.empty}>{emptyText}</p>
                ) : (
                  visible.map(({ card, progress }) => (
                    <LiveCaseCard
                      key={card.caseId}
                      caseId={card.caseId}
                      caseNumber={card.caseNumber}
                      time={card.time}
                      zone={card.zoneCode}
                      waitMinutes={card.waitMinutes}
                      progress={progress}
                      pick={card.pick}
                      eta={card.eta}
                      overReach={card.overReach}
                      onOpen={() => setOpenId(card.caseId)}
                      onAccept={card.canDecide ? () => runAccept(card) : undefined}
                      onOverride={card.canDecide ? () => openOverride(card) : undefined}
                      acceptDisabledReason={card.canDecide ? gate.edit.reason : undefined}
                      overrideDisabledReason={card.canDecide ? gate.edit.reason : undefined}
                    />
                  ))
                )}
                {placed.length > COLUMN_CAP ? (
                  <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => ({ ...e, [column]: e[column] !== true }))}>
                    {expanded[column] === true ? m('less') : m('more', { n: placed.length - COLUMN_CAP })}
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      <CaseDrawer
        target={opened?.card ?? null}
        progress={opened?.progress}
        disabledReason={gate.edit.reason}
        onClose={() => setOpenId(null)}
        onAccept={() => opened && runAccept(opened.card)}
        onOverride={() => opened && openOverride(opened.card)}
        onAi={() => {
          if (opened === undefined) return;
          setOpenId(null);
          url.update({ ai: opened.card.caseId }, { history: 'push', keepPage: true });
        }}
      />
      <OverrideDrawer
        target={overriding}
        reasonOptions={reasonOptions}
        pending={overrideAction.pending}
        error={overrideAction.error}
        onClose={() => {
          setOverriding(null);
          overrideAction.reset();
        }}
        onConfirm={(input, agentName, reasonLabel) => {
          pendingName.current = agentName;
          pendingReason.current = reasonLabel;
          overrideAction.run(input);
        }}
      />
    </>
  );
}
