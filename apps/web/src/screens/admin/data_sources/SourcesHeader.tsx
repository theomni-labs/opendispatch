'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Eye, Plug, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { allToShadow, testAllFeeds } from './actions';
import { ReasonModal } from './ReasonModal';

// The header of the Data Sources screen: "Test all" (the one primary action) and "More" (All zones to shadow, Export). The
// mockup's "State" radio group is review tooling of the mockup and is not built (`?state=` is the app's review hook).
// THE INTEGRATION TESTS ARE SCRIPTED (nothing is sent), which the screen says with a "Demo" tag next to the feeds.

export interface SourcesHeaderProps {
  readonly canEdit: boolean;
  /** How many zones are not in shadow now: what "All zones to shadow" would change. */
  readonly zonesNotShadow: number;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** The stage table as text; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

export function SourcesHeader({ canEdit, zonesNotShadow, exportFilename, exportHeader, exportRows }: SourcesHeaderProps) {
  const m = useTranslations('admin.data_sources');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [confirming, setConfirming] = useState(false);
  const testAll = useAdminAction(testAllFeeds, {
    quiet: true,
    onSuccess: (result) => toast({ title: m('toast.all.title'), description: m('toast.all.desc', { ok: result.answered, slow: result.slow + result.failed }), tone: result.slow + result.failed > 0 ? 'warning' : 'success' }),
    failureToast: true,
  });
  const shadow = useAdminAction(allToShadow, {
    successTitle: m('toast.allShadow'),
    onSuccess: () => setConfirming(false),
  });

  const reason = gate.edit.reason;
  const items: MenuEntry[] = [
    ...(reason === null ? [] : [{ type: 'heading', label: reason } as const]),
    { label: m('menu.allShadow'), icon: <Eye />, disabled: reason !== null, onSelect: () => setConfirming(true) },
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
      <ReasonHint reason={reason} visible={false}>
        <Button variant="primary" startIcon={<Zap />} loading={testAll.pending} onClick={() => reason === null && testAll.run()}>
          {m('testAll')}
        </Button>
      </ReasonHint>
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
      <ReasonModal
        open={confirming}
        onClose={() => {
          setConfirming(false);
          shadow.reset();
        }}
        onConfirm={(note) => shadow.run({ reason: note })}
        title={m('m.all')}
        description={m('m.allDesc', { n: zonesNotShadow })}
        required={false}
        pending={shadow.pending}
        error={<ActionError error={shadow.error} onDismiss={shadow.reset} />}
      />
    </>
  );
}

/** The empty state's one action: "Connect a source" shows a placeholder message (there is no source setup yet). Labelled Demo. */
export function ConnectSourceButton({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.data_sources');
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  return (
    <>
      <ReasonHint reason={gate.edit.reason} visible>
        <Button variant="secondary" startIcon={<Plug />} onClick={() => gate.edit.allowed && toast({ title: m('toast.connect'), tone: 'info' })}>
          {m('connect')}
        </Button>
      </ReasonHint>
      <StubTag kind="demo" />
    </>
  );
}
