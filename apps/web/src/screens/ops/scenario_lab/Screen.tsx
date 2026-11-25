// SPDX-License-Identifier: AGPL-3.0-only
import { Card } from '@opendispatch/ui';
import { getTranslations } from 'next-intl/server';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { ComparisonPanel } from './ComparisonPanel';
import { HeaderActions, NewScenarioButton } from './HeaderActions';
import styles from './ScenarioLab.module.css';
import { SavedScenariosTable } from './SavedScenariosTable';
import { TemplateCards } from './TemplateCards';
import { Workspace } from './Workspace';
import { TEMPLATE_KEYS } from './types';
import { loadScenarioLabView } from './view';

// Scenario Lab (Ops 8, flow 4)

const SCENARIO_PARAM = /^([0-9a-f-]{36}|new)$/i;

export async function ScenarioLabScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('ops.scenario_lab');
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const canEdit = access.access === 'edit';

  if (state !== undefined) {
    return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={<HeaderActions canEdit={canEdit} />} />;
  }

  const query = parseSearchParams(searchParams, {
    scenario: param.pattern(SCENARIO_PARAM, 36),
    tpl: param.enum(TEMPLATE_KEYS),
  });
  const [view, assistant] = await Promise.all([loadScenarioLabView(ctx, query, locale), assistantAvailability(ctx)]);
  const actions = <HeaderActions canEdit={canEdit} />;

  if (view.isEmpty) {
    return <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={m('sub')} actions={actions} isEmpty emptyAction={<NewScenarioButton canEdit={canEdit} />} />;
  }

  const form = view.openIsNew ? { ...view.form, name: m(query.tpl === undefined ? 'untitled' : `tpl.${query.tpl}.name`) } : view.form;
  const editorKey = `${view.openId ?? 'new'}:${query.tpl ?? ''}`;

  return (
    <ScreenFrame def={def} access={access} homeHref={homeHref} sources={view.sources} description={m('sub')} actions={actions}>
      <div className={styles.stack}>
        {view.unknownId ? <RecordNotice param="scenario" message={m('notice.notFound')} /> : null}

        <TemplateCards canEdit={canEdit} />

        <Workspace
          editorKey={editorKey}
          assist={assistant === null ? null : { configured: assistant.configured, allowed: assistant.scenarioDraft }}
          openId={view.openId}
          form={form}
          zoneOptions={view.zoneOptions}
          patternOptions={view.patternOptions}
          dateOptions={view.dateOptions}
          status={view.openStatus}
          lastRunLabel={view.openLastRunLabel}
          canEdit={canEdit}
        />

        <ComparisonPanel m={m} comparison={view.comparison} />

        <Card padding="none">
          <h2 className={`${styles.cardTitle} ${styles.listHead}`}>{m('list.title')}</h2>
          <SavedScenariosTable rows={view.savedRows} caption={m('list.title')} canEdit={canEdit} />
        </Card>
      </div>
    </ScreenFrame>
  );
}
