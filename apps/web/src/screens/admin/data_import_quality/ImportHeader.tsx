'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, FileText, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { saveCsv } from '@/lib/export/download';

// The header of the Data Import and Quality screen: "Upload file" (the one primary action: it goes to the Import tab and the drop
// area) and "More" (Download mapping, Export issues). The mockup's "State" and "Rejected file" groups are review tooling of the
// mockup and are not built: `?state=` is the app's review hook, and the drop area refuses a wrong file with its own message.

export interface ImportHeaderProps {
  readonly canEdit: boolean;
  /** The mapping as a CSV (source column, internal field, required); undefined while the page shows a review state. */
  readonly mappingRows: readonly (readonly string[])[] | undefined;
  readonly mappingFilename: string;
  readonly mappingHeader: readonly string[];
  /** The issues on screen as text; undefined while the page shows a review state. */
  readonly issueRows: readonly (readonly string[])[] | undefined;
  readonly issueHeader: readonly string[];
}

/** The empty state's one action: back to the page with its Import tab (the address loses `?state=`). Disabled with a reason for a view-only role. */
export function EmptyUpload({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.data_import_quality');
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  return (
    <ReasonHint reason={gate.edit.reason} visible>
      <Button variant="secondary" startIcon={<Upload />} onClick={() => gate.edit.allowed && url.update({ state: null })}>
        {m('upload')}
      </Button>
    </ReasonHint>
  );
}

export function ImportHeader({ canEdit, mappingRows, mappingFilename, mappingHeader, issueRows, issueHeader }: ImportHeaderProps) {
  const m = useTranslations('admin.data_import_quality');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const items: MenuEntry[] = [
    {
      label: m('menu.mapping'),
      icon: <FileText />,
      disabled: mappingRows === undefined || mappingRows.length === 0,
      onSelect: () => {
        if (mappingRows === undefined) return;
        saveCsv(mappingFilename, { header: [...mappingHeader], rows: mappingRows.map((row) => [...row]) });
        toast({ title: m('toast.mapping'), tone: 'info' });
      },
    },
    {
      label: m('menu.exportIssues'),
      icon: <Download />,
      disabled: issueRows === undefined,
      onSelect: () => {
        if (issueRows === undefined) return;
        saveCsv('data-quality-issues.csv', { header: [...issueHeader], rows: issueRows.map((row) => [...row]) });
        toast({ title: m('toast.export'), tone: 'info' });
      },
    },
  ];
  return (
    <>
      <ReasonHint reason={gate.edit.reason} visible={false}>
        <Button variant="primary" startIcon={<Upload />} onClick={() => gate.edit.allowed && url.update({ tab: null, issue: null }, { history: 'push' })}>
          {m('upload')}
        </Button>
      </ReasonHint>
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
