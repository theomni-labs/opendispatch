'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Play, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { retrainNow } from './actions';
import { useRun } from './RunState';

// The header of the Forecast and Model Admin screen: "Run forecast" (the one primary action) and "More" (Retrain now, Export). The
// mockup's "State" radio group is review tooling of the mockup and is not built (`?state=` is the app's review hook).
// "Retrain now" refits the champion and starts a backtest in the background; the result shows in Experiments.

export interface RunForecastButtonProps {
  readonly canEdit: boolean;
  readonly paused: boolean;
  readonly variant?: 'primary' | 'secondary';
  readonly size?: 'sm' | 'md';
}

export function RunForecastButton({ canEdit, paused, variant = 'primary', size = 'md' }: RunForecastButtonProps) {
  const m = useTranslations('admin.forecast_model');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const run = useRun();
  const reason = gate.edit.reason ?? (paused ? m('run.paused') : null);
  return (
    <ReasonHint reason={reason} visible={false}>
      <Button variant={variant} size={size} startIcon={<Play />} loading={run.pending} aria-busy={run.pending} onClick={() => reason === null && run.start()}>
        {run.pending ? m('r.running') : m('run.label')}
      </Button>
    </ReasonHint>
  );
}

export interface ModelHeaderProps {
  readonly canEdit: boolean;
  readonly paused: boolean;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** The version table as text; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

export function ModelHeader({ canEdit, paused, exportFilename, exportHeader, exportRows }: ModelHeaderProps) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const retrain = useAdminAction(retrainNow, { successTitle: m('toast.retrain.title'), successDescription: () => m('toast.retrain.desc') });
  const reason = gate.edit.reason ?? (paused ? m('run.paused') : null);
  const items: MenuEntry[] = [
    ...(gate.edit.reason === null ? [] : [{ type: 'heading', label: gate.edit.reason } as const]),
    { label: m('menu.retrain'), icon: <RotateCcw />, disabled: reason !== null || retrain.pending, onSelect: () => reason === null && retrain.run() },
    {
      label: t('common.export'),
      icon: <Download />,
      disabled: exportRows === undefined,
      onSelect: () => {
        if (exportRows === undefined) return;
        saveCsv(exportFilename, { header: [...exportHeader], rows: exportRows.map((row) => [...row]) });
        toast({ title: m('toast.export'), tone: 'info' });
      },
    },
  ];
  return (
    <>
      <RunForecastButton canEdit={canEdit} paused={paused} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
      <ActionError error={retrain.error} onDismiss={retrain.reset} />
    </>
  );
}
