'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, Field, QuantityInput, Switch } from '@opendispatch/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveSuggestions } from './actions';
import type { DispatchSuggestions } from './types';
import styles from './DataSources.module.css';

// Dispatch suggestions (#ds2-sug; the operator fallback rule, advisory)

export interface SuggestionsCardProps {
  readonly saved: DispatchSuggestions;
  readonly canEdit: boolean;
}

export function SuggestionsCard({ saved, canEdit }: SuggestionsCardProps) {
  const m = useTranslations('admin.data_sources');
  const t = useTranslations();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [draft, setDraft] = useState(saved);
  // Follow new saved values from the server
  const [seen, setSeen] = useState(saved);
  if (seen.reposition !== saved.reposition || seen.maxMoveKm !== saved.maxMoveKm || seen.prayerPenalty !== saved.prayerPenalty) {
    setSeen(saved);
    setDraft(saved);
  }
  const save = useAdminAction(saveSuggestions, { successTitle: m('toast.sugSaved') });

  const dirty = draft.reposition !== saved.reposition || draft.maxMoveKm !== saved.maxMoveKm || draft.prayerPenalty !== saved.prayerPenalty;
  const validKm = Number.isFinite(draft.maxMoveKm) && draft.maxMoveKm > 0 && draft.maxMoveKm <= 50;
  const saveReason = gate.edit.reason ?? (!dirty ? m('nochange') : !validKm ? m('sug.range') : null);

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h3 className={styles.cardTitle}>{m('sug.title')}</h3>
        </div>
        <Switch label={m('sug.spots')} checked={draft.reposition} disabled={!canEdit} onCheckedChange={(next) => setDraft({ ...draft, reposition: next })} />
        <Field label={m('sug.maxKm')}>
          <QuantityInput
            value={draft.maxMoveKm}
            min={0.5}
            max={50}
            step={0.5}
            uom={m('uom.km')}
            disabled={!canEdit}
            aria-label={m('sug.maxKm')}
            onChange={(n) => setDraft({ ...draft, maxMoveKm: n })}
          />
        </Field>
        <Switch label={m('sug.prayer')} checked={draft.prayerPenalty} disabled={!canEdit} onCheckedChange={(next) => setDraft({ ...draft, prayerPenalty: next })} />
        <div className={styles.between}>
          {dirty ? <Reason icon={<Info />}>{m('unsaved')}</Reason> : <span />}
          <ReasonHint reason={saveReason} visible={false}>
            <Button variant="secondary" size="sm" loading={save.pending} onClick={() => saveReason === null && save.run(draft)}>
              {t('common.save')}
            </Button>
          </ReasonHint>
        </div>
        <ActionError error={save.error} onDismiss={save.reset} />
      </div>
    </Card>
  );
}
