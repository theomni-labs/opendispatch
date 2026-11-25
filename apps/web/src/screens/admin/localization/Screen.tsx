// SPDX-License-Identifier: AGPL-3.0-only
import { Card, CardHeader, Progress, Tag, Tooltip, Button } from '@opendispatch/ui';
import { SlidersHorizontal } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import { DEFAULT_SETTINGS, type CoverageRow, type FallbackSample } from './types';
import type { ScreenProps } from '@/screens/types';
import { LocalizationForm, LocalizationHeader, LocalizationPreview } from './LocalizationForms';
import { LocalizationProvider } from './LocalizationState';
import styles from './Localization.module.css';
import { loadLocalizationView } from './view';

// Localization: one page with the settings form, the Arabic names coverage, the preview and the fallback preview.
// A Server Component: it reads through lib/data with the request context ModuleRoute built and passes plain data to the client files.
// The header's Save and the form share one draft (LocalizationProvider wraps the frame). The settings are STORED AND AUDITED, NOT
// APPLIED: each carries the "Not applied" tag, and the preview and the fallback preview are Illustrative. The time
// zone is fixed for the install. `?state=empty|loading|error` (demo-mode review hook) shows those states without reading data.

type Translate = Awaited<ReturnType<typeof getTranslations>>;

export async function LocalizationScreen({ def, ctx, access, homeHref, state }: ScreenProps) {
  const m = await getTranslations('admin.localization');
  const canEdit = access.access === 'edit';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <LocalizationProvider saved={DEFAULT_SETTINGS} canEdit={canEdit} review>
        <ScreenFrame
          def={def}
          access={access}
          state={state}
          homeHref={homeHref}
          actions={<LocalizationHeader />}
          emptyAction={
            <Button variant="secondary" href="/admin/localization" startIcon={<SlidersHorizontal />}>
              {m('empty.action')}
            </Button>
          }
        />
      </LocalizationProvider>
    );
  }

  const view = await loadLocalizationView(ctx);
  const columns: AdminTableColumn[] = [
    { key: 'data', header: m('col.data') },
    { key: 'records', header: m('col.records'), align: 'end' },
    { key: 'arabic', header: m('col.arabic'), align: 'end' },
    { key: 'coverage', header: m('col.coverage'), hideBelow: 'md' },
  ];

  return (
    <LocalizationProvider saved={view.settings} canEdit={canEdit}>
      <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} actions={<LocalizationHeader />}>
        <div className={styles.detailGrid}>
          <div className={styles.col}>
            <LocalizationForm />
            <Card padding="none">
              <CardHeader title={m('names.title')} actions={<span className={styles.meta}>{m('names.fallback')}</span>} />
              <AdminTable caption={m('names.title')} columns={columns} rows={view.coverage.map((row) => coverageRow(row, m))} rowParam={false} pageSize={0} />
            </Card>
          </div>
          <aside className={styles.col}>
            <LocalizationPreview />
            <Card padding="lg">
              <div className={styles.col}>
                <h2 className={styles.sectionTitle}>{m('fb.title')}</h2>
                <dl className={styles.kv}>
                  {view.samples.map((sample) => (
                    <FallbackRow key={sample.id} sample={sample} m={m} />
                  ))}
                </dl>
              </div>
            </Card>
          </aside>
        </div>
      </ScreenFrame>
    </LocalizationProvider>
  );
}

function coverageRow(row: CoverageRow, m: Translate): AdminTableRow {
  const percent = row.records === 0 ? 0 : Math.round((row.arabic / row.records) * 100);
  return {
    id: row.kind,
    label: m(`k.${row.kind}`),
    cells: {
      data: m(`k.${row.kind}`),
      records: <span translate="no">{row.records}</span>,
      arabic: <span translate="no">{row.arabic}</span>,
      coverage: <Progress value={percent} tone={percent === 100 ? 'success' : 'warning'} size="sm" valueLabel={`${percent}%`} />,
    },
  };
}

function FallbackRow({ sample, m }: { sample: FallbackSample; m: Translate }) {
  return (
    <div className={styles.kvRow}>
      <dt translate="no">{sample.english}</dt>
      <dd>
        {sample.arabic === null ? (
          <>
            <span translate="no" dir="ltr">
              {sample.english}
            </span>
            <Tooltip content={m('fb.tip')}>
              <span tabIndex={0}>
                <Tag color="gray">{m('fb.tag')}</Tag>
              </span>
            </Tooltip>
          </>
        ) : (
          <span lang="ar" dir="rtl" translate="no">
            {sample.arabic}
          </span>
        )}
      </dd>
    </div>
  );
}
