// SPDX-License-Identifier: AGPL-3.0-only
import { Card, Stepper } from '@opendispatch/ui';
import { int } from '@opendispatch/ui/format';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { assistantAvailability } from '@/components/opendispatch/assistant/availability';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { NoMatch } from '@/components/opendispatch/patterns/NoMatch';
import { RecordNotice } from '@/components/opendispatch/patterns/RecordDrawer';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { StatStrip } from '@/components/opendispatch/patterns/StatStrip';
import { TabPanel, UrlTabs } from '@/components/opendispatch/patterns/UrlTabs';
import { ScreenFrame } from '@/components/opendispatch/ScreenFrame';
import type { ScreenProps } from '@/screens/types';
import { NewRuleButton, RuleDrawer, RulesHeader } from './RulesForms';
import { AiReview } from './AiReview';
import { ApprovalsTable, OutcomeTag, RulesTable } from './RulesTables';
import styles from './ClassificationRules.module.css';
import { OUTCOMES, RULE_STATUSES, type Outcome } from './types';
import { loadAiReview, loadRulesView } from './view';

// Classification Rules. A Server Component: it reads through lib/data with the request context
// ModuleRoute built, and passes plain data to the client files (tables, drawer, dialog). Tab, search, status and outcome filters,
// sort, page, the open rule and its version live in the address (?tab= ?q= ?status= ?outcome= ?sort= ?page= ?rule=<code|new>
// ?version=<n>); each is checked here against an allow-list. The Administrator drafts and submits; the Dispatch Supervisor has view
// access and approves or rejects, never a version they submitted. `?state=empty|loading|error` (demo-mode review hook) shows
// those states without reading data.

const TABS = ['rules', 'approvals', 'ai'] as const;
const EXPORT_FILE = 'classification-rules.csv';
const RULE_PARAM = /^(RULE-[0-9]{3}[A-Z]?|new)$/;

/**
 * Precedence and the outcome of a case that matches no rule: and the settings `classification.precedence` and
 * `classification.default_outcome`. The data layer has no operation that reads those two settings, so the card shows the
 * decided defaults as constants (a stored change would not show here). Reported as a data layer gap in docs/.
 */
const PRECEDENCE: readonly Outcome[] = ['field_mandatory', 'field_preferred', 'remote_eligible'];
const DEFAULT_OUTCOME: Outcome = 'field_preferred';

export async function ClassificationRulesScreen({ def, ctx, access, homeHref, locale: pageLocale, state, searchParams }: ScreenProps) {
  const m = await getTranslations('admin.classification_rules');
  const t = await getTranslations();
  const canEdit = access.access === 'edit';

  // A review state reads nothing: the frame shows the state instead of the content.
  if (state !== undefined) {
    return (
      <ScreenFrame
        def={def}
        access={access}
        state={state}
        homeHref={homeHref}
        actions={<RulesHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={[]} exportRows={undefined} />}
        emptyAction={<NewRuleButton canEdit={canEdit} variant="secondary" />}
      />
    );
  }

  const query = parseSearchParams(searchParams, {
    tab: param.enum(TABS),
    q: param.text(80),
    status: param.enum(RULE_STATUSES),
    outcome: param.enum(OUTCOMES),
    sort: param.sort(['rule', 'status', 'eff']),
    rule: param.pattern(RULE_PARAM, 12),
    version: param.int(1, 999),
    page: param.int(1, 1000),
    only: param.enum(['all'] as const),
  });
  const [view, assistant] = await Promise.all([
    loadRulesView(ctx, { q: query.q, status: query.status, outcome: query.outcome, rule: query.rule, version: query.version }),
    query.rule === 'new' || query.tab === 'ai' ? assistantAvailability(ctx) : Promise.resolve(null),
  ]);
  const locale: 'en' | 'ar' = pageLocale === 'ar' ? 'ar' : 'en';
  const tab = query.tab ?? 'rules';
  const aiReview = tab === 'ai' ? await loadAiReview(ctx, query.only ?? 'disagreements', locale).catch(() => null) : null;
  const number = (value: number) => <bdi translate="no">{int(value, locale)}</bdi>;

  const tabs = (
    <UrlTabs
      id="cr"
      ariaLabel={m('tabs.label')}
      defaultTab="rules"
      resetParams={['q', 'sort', 'rule', 'version', 'only']}
      tabs={[
        { value: 'rules', label: m('tab.rules'), count: view.total },
        { value: 'approvals', label: m('tab.approvals'), count: view.pendingApprovals },
        { value: 'ai', label: m('tab.ai') },
      ]}
    />
  );

  const rulesTab: ReactNode = (
    <TabPanel id="cr" value="rules">
      <div className={styles.stack}>
        <StatStrip
          items={[
            { label: m('st.active'), value: view.counts.active },
            { label: m('st.draft'), value: view.counts.draft },
            { label: m('st.pending'), value: view.counts.pending },
          ]}
        />
        <div className={styles.grid}>
          <Card padding="none">
            <ListToolbar
              searchLabel={m('q')}
              filters={[
                { key: 'status', label: t('common.status'), options: RULE_STATUSES.map((status) => ({ value: status, label: m(`st.${status}`) })) },
                { key: 'outcome', label: m('col.outcome'), options: OUTCOMES.map((outcome) => ({ value: outcome, label: m(`out.${outcome}`) })) },
              ]}
            />
            <RulesTable rows={view.rules} caption={m('tab.rules')} emptyState={<NoMatch title={m('nomatch')} clearParams={['q', 'status', 'outcome']} />} sort={query.sort} page={query.page} />
            <div className={styles.summary}>{m('showing', { n: view.rules.length, total: view.total })}</div>
          </Card>
          <aside className={styles.col}>
            <Card padding="lg">
              <h2 className={styles.cardTitle}>{m('prec.title')}</h2>
              <ol className={styles.precedence} role="list">
                {PRECEDENCE.map((outcome, index) => (
                  <li key={outcome} className={styles.precedenceItem}>
                    <span className={styles.muted}>{number(index + 1)}</span>
                    <OutcomeTag outcome={outcome} />
                  </li>
                ))}
              </ol>
              <p className={styles.meta}>
                <span>{m('prec.default')}</span>
                <OutcomeTag outcome={DEFAULT_OUTCOME} />
              </p>
            </Card>
            <Card padding="lg">
              <h2 className={styles.cardTitle}>{m('wf.title')}</h2>
              <Stepper
                orientation="vertical"
                current={-1}
                steps={[
                  { label: m('st.draft'), description: t('roles.administrator') },
                  { label: m('st.submitted'), description: t('roles.administrator') },
                  { label: m('st.approved'), description: t('roles.dispatch_supervisor') },
                  { label: m('st.retired'), description: t('roles.administrator') },
                ]}
              />
              <p className={styles.meta}>{m('wf.rejected')}</p>
            </Card>
          </aside>
        </div>
      </div>
    </TabPanel>
  );

  const approvalsTab: ReactNode = (
    <TabPanel id="cr" value="approvals">
      <Card padding="none">
        <ApprovalsTable rows={view.approvals} caption={m('tab.approvals')} />
      </Card>
    </TabPanel>
  );

  const aiTab: ReactNode = (
    <TabPanel id="cr" value="ai">
      {aiReview === null ? (
        <Card padding="lg">
          <p className={styles.muted}>{m('ai.loadError')}</p>
        </Card>
      ) : (
        <AiReview view={aiReview} canEdit={canEdit} configured={assistant?.configured ?? false} />
      )}
    </TabPanel>
  );

  return (
    <ScreenFrame
      def={def}
      access={access}
      homeHref={homeHref}
      sources={tab === 'ai' && aiReview !== null ? aiReview.sources : view.sources}
      isEmpty={view.total === 0}
      emptyAction={<NewRuleButton canEdit={canEdit} variant="secondary" />}
      overlays={
        <RuleDrawer
          open={view.open}
          isNew={query.rule === 'new' && canEdit}
          canEdit={canEdit}
          caseTypes={view.caseTypes}
          caseTypeLabels={view.caseTypeLabels[locale]}
          assistant={assistant !== null && assistant.ruleDraft ? { configured: assistant.configured } : undefined}
        />
      }
      tabs={tabs}
      actions={<RulesHeader canEdit={canEdit} exportFilename={EXPORT_FILE} exportHeader={view.exportHeader} exportRows={view.exportRows} />}
    >
      <div className={styles.stack}>
        {view.unknownRule ? <RecordNotice param="rule" message={m('notice.notFound')} /> : null}
        {tab === 'approvals' ? approvalsTab : tab === 'ai' ? aiTab : rulesTab}
      </div>
    </ScreenFrame>
  );
}
