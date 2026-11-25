'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { ArrowRight, CircleCheck, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import styles from './RecommendedMove.module.css';
import { applyMoveAction } from './actions';
import type { RecommendedMoveView } from './view';

// Recommended move card (#sc-reco)

export interface RecommendedMoveProps {
  readonly zoneId: string;
  readonly date: string;
  readonly move: RecommendedMoveView | null;
  readonly uncoveredCount: number;
  readonly canEdit: boolean;
  /** Admin Locations, when the role may open it. */
  readonly locationsHref: string | null;
}

export function RecommendedMove({ zoneId, date, move, uncoveredCount, canEdit, locationsHref }: RecommendedMoveProps) {
  const m = useTranslations('ops.standby_coverage');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [applied, setApplied] = useState<string | null>(null);
  const apply = useAdminAction(applyMoveAction, {
    successTitle: move === null ? undefined : m('toast.moved', { from: move.fromName, to: move.toName }),
    successDescription: m('toast.movedDesc'),
    onSuccess: () => setApplied(`${zoneId}/${date}`),
  });

  if (move === null) {
    const done = applied === `${zoneId}/${date}`;
    const blocked = uncoveredCount > 0 && !done;
    return (
      <div className={styles.stack}>
        <span className={styles.reason}>
          {blocked ? <Info size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}
          <span>{m(done ? 'reco.done' : blocked ? 'reco.noneUnc' : 'reco.none')}</span>
        </span>
        {blocked && locationsHref !== null ? (
          <span>
            <Button variant="secondary" size="sm" href={locationsHref}>
              {m('reco.locations')}
            </Button>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.moveRow}>
        <b translate="no">{move.fromName}</b>
        <ArrowRight size={16} aria-hidden="true" className="icon-flip" />
        <b translate="no">{move.toName}</b>
      </div>
      <span className={styles.reasonLine}>
        {m('reco.n', { n: move.agents })}
        {' · '}
        <span lang="en" dir="ltr" translate="no">
          {move.reasonEn}
        </span>
      </span>
      <ReasonHint reason={!canEdit ? gate.edit.reason : null} visible={false}>
        <Button
          variant="primary"
          loading={apply.pending}
          onClick={() =>
            apply.run({ zone_id: zoneId, roster_date: date, from_standby_point_id: move.fromId, to_standby_point_id: move.toId, agents: move.agents })
          }
        >
          {m('reco.apply')}
        </Button>
      </ReasonHint>
      <ActionError error={apply.error} onDismiss={apply.reset} />
    </div>
  );
}
