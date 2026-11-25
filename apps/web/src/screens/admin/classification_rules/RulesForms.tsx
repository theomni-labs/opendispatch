'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DateInput, DescriptionList, Field, Input, Menu, RadioGroup, Stack, Timeline, useFormat, useToast, type MenuEntry, type TimelineItem, type Tone } from '@opendispatch/ui';
import { Ban, CalendarCheck, Check, ChevronDown, Download, GitBranch, Info, Lock, Pencil, Plus, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { RuleDraftBlock } from '@/components/opendispatch/assistant/RuleDraftBlock';
import { draftNewVersion, draftRule, draftRuleFromText, retireRuleNow, saveRuleDraft } from './actions';
import { ConditionBuilder } from './ConditionBuilder';
import { defaultDraft, draftsOf, predicatesOf, type PredicateDraft } from './condition';
import { DecisionDialog } from './DecisionDialog';
import { OutcomeTag, RuleName, StatusBadge, useDenialReason } from './RulesTables';
import { OUTCOMES, type HistoryItem, type OpenRule, type Outcome, type VersionRow } from './types';
import styles from './ClassificationRules.module.css';

// The forms of the Classification Rules screen: the header's New rule and More, and the drawer that
// drafts, edits, submits, approves, rejects, versions and retires a rule. Every write is a server action through
// useAdminAction; the data layer authorises, validates and audits. A role without `edit` sees the same controls disabled with
// the reason; Approve and Reject follow `denial`, which the server decided (a Dispatch Supervisor approves; nobody
// approves their own submission). Nothing here names the caller.

const RULE_CODE = /^RULE-[0-9]{3}[A-Z]?$/;
const CLOSE = { rule: null, version: null } as const;

// ---------------------------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------------------------

export function NewRuleButton({ canEdit, variant = 'primary' }: { canEdit: boolean; variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('admin.classification_rules');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ rule: 'new', version: null }, { history: 'push', keepPage: true })}>
        {m('new')}
      </Button>
    </ReasonHint>
  );
}

export interface RulesHeaderProps {
  readonly canEdit: boolean;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** Every rule as CSV cells; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

/** The two header actions: New rule (primary) and More (Export). */
export function RulesHeader({ canEdit, exportFilename, exportHeader, exportRows }: RulesHeaderProps) {
  const m = useTranslations('admin.classification_rules');
  const t = useTranslations();
  const toast = useToast();
  const items: MenuEntry[] = [
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
      <NewRuleButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The rule's history, from its versions
// ---------------------------------------------------------------------------------------------

const HISTORY: Readonly<Record<HistoryItem['kind'], { tone: Tone; icon: ReactNode }>> = {
  created: { tone: 'info', icon: <Pencil /> },
  submitted: { tone: 'info', icon: <Send /> },
  approved: { tone: 'success', icon: <Check /> },
  rejected: { tone: 'danger', icon: <X /> },
  effect: { tone: 'info', icon: <CalendarCheck /> },
  retired: { tone: 'warning', icon: <Ban /> },
};

function History({ items }: { items: readonly HistoryItem[] }) {
  const m = useTranslations('admin.classification_rules');
  const format = useFormat();
  const timeline: TimelineItem[] = items.map((item) => {
    const title =
      item.kind === 'created'
        ? item.name === null
          ? m('tl.drafted')
          : m('tl.created', { name: item.name })
        : item.kind === 'submitted'
          ? m('tl.submitted')
          : item.kind === 'approved'
            ? item.name === null
              ? m('st.approved')
              : m('tl.approved', { name: item.name })
            : item.kind === 'rejected'
              ? item.name === null
                ? m('st.rejected')
                : m('tl.rejected', { name: item.name })
              : item.kind === 'effect'
                ? m('tl.effect', { date: format.date(item.at) })
                : m('tl.retired');
    return {
      id: item.id,
      title: <span translate={item.name === null ? undefined : 'no'}>{title}</span>,
      time: format.date(item.at),
      tone: HISTORY[item.kind].tone,
      icon: HISTORY[item.kind].icon,
      description: (
        <>
          <span>{m('v.label', { n: item.version })}</span>
          {item.note === null || item.note === '' ? null : (
            <>
              {' · '}
              <span translate="no">{item.note}</span>
            </>
          )}
        </>
      ),
    };
  });
  return <Timeline dense items={timeline} />;
}

// ---------------------------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------------------------

interface FormState {
  readonly name: string;
  readonly nameAr: string;
  readonly code: string;
  readonly match: 'all' | 'any';
  readonly rows: readonly PredicateDraft[];
  readonly conditionText: string;
  readonly outcome: Outcome;
  readonly from: string;
  readonly to: string;
}

function initialState(open: OpenRule | undefined, caseTypes: readonly string[]): FormState {
  const shown = open?.versions.find((v) => v.version === open.shown);
  if (open === undefined || shown === undefined) {
    return { name: '', nameAr: '', code: '', match: 'all', rows: [{ ...defaultDraft('parties_involved', caseTypes), value: '3' }], conditionText: '', outcome: 'field_mandatory', from: '', to: '' };
  }
  return { name: open.rule.name, nameAr: open.rule.nameAr ?? '', code: open.rule.code, match: shown.condition.match, rows: draftsOf(shown.condition), conditionText: shown.conditionText, outcome: shown.outcome, from: shown.effectiveFrom ?? '', to: shown.effectiveTo ?? '' };
}

export interface RuleDrawerProps {
  /** The rule `?rule=` opens; undefined for a new rule and for a code that does not exist. */
  readonly open: OpenRule | undefined;
  /** `?rule=new` and the person may edit. Decided on the server. */
  readonly isNew: boolean;
  readonly canEdit: boolean;
  readonly caseTypes: readonly string[];
  readonly caseTypeLabels?: Readonly<Record<string, string>> | undefined;
  /** The assistant's draft block; absent when the role may not draft. */
  readonly assistant?: { readonly configured: boolean } | undefined;
}

export function RuleDrawer({ open, isNew, canEdit, caseTypes, caseTypeLabels, assistant }: RuleDrawerProps) {
  const m = useTranslations('admin.classification_rules');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const outcomeName = useId();
  const shown: VersionRow | undefined = open?.versions.find((v) => v.version === open.shown);
  const visible = isNew || (open !== undefined && shown !== undefined);
  const recordKey = !visible ? '' : isNew ? 'new' : `${open?.rule.code}:${open?.shown}`;

  const [seen, setSeen] = useState(recordKey);
  const [form, setForm] = useState<FormState>(() => initialState(isNew ? undefined : open, caseTypes));
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [retiring, setRetiring] = useState(false);
  if (recordKey !== seen) {
    setSeen(recordKey);
    setForm(initialState(isNew ? undefined : open, caseTypes));
    setDeciding(null);
    setRetiring(false);
  }

  const denialReason = useDenialReason(open?.denial ?? null);
  const done = () => url.update(CLOSE, { history: 'replace', keepPage: true });
  const save = useAdminAction(draftRule, {
    successTitle: (result) => m(result.submitted === true ? 'toast.submitted.title' : 'toast.created'),
    successDescription: (result) => (result.submitted === true ? m('toast.submitted.desc') : result.code),
    onSuccess: done,
  });
  const saveExisting = useAdminAction(saveRuleDraft, {
    successTitle: (result) => m(result.submitted === true ? 'toast.submitted.title' : 'toast.saved'),
    successDescription: (result) => (result.submitted === true ? m('toast.submitted.desc') : result.code),
    onSuccess: done,
  });
  const version = useAdminAction(draftNewVersion, {
    successTitle: m('toast.version'),
    successDescription: (result) => result.code,
    onSuccess: (result) => url.update({ version: String(result.version) }, { history: 'replace', keepPage: true }),
  });
  const retire = useAdminAction(retireRuleNow, {
    successTitle: m('toast.retired'),
    successDescription: (result) => result.code,
    onSuccess: () => {
      setRetiring(false);
      done();
    },
  });

  if (!visible) return <RecordDrawer open={false} param="rule" title="" />;

  const status = isNew || shown === undefined ? 'draft' : shown.status;
  const ruleRetired = open?.rule.ruleStatus === 'retired';
  const editable = isNew || (status === 'draft' && !ruleRetired);
  const fieldsDisabled = !editable || !gate.edit.allowed;
  const predicates = predicatesOf(form.rows);
  const need: string | null = isNew && !RULE_CODE.test(form.code.trim()) ? m('need.code') : form.name.trim() === '' || form.conditionText.trim() === '' ? m('need.name') : predicates === undefined ? m('need.cond') : null;
  const change = (patch: Partial<FormState>) => {
    save.reset();
    saveExisting.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const pending = save.pending || saveExisting.pending;
  const error = save.error ?? saveExisting.error;

  function submit(andSubmit: boolean) {
    if (!gate.edit.allowed || need !== null || predicates === undefined) return;
    const body = { match: form.match, predicates, condition_text_en: form.conditionText.trim(), outcome: form.outcome, effective_from: form.from, effective_to: form.to, submit: andSubmit };
    if (isNew) save.run({ ...body, rule_code: form.code.trim(), name_en: form.name.trim(), name_ar: form.nameAr.trim() });
    else if (open !== undefined && shown !== undefined) saveExisting.run({ ...body, rule_code: open.rule.code, version: shown.version });
  }

  const editReason = gate.edit.reason ?? need;
  const working = open?.rule.working ?? null;
  const footer = (
    <div className={styles.footer}>
      {status === 'submitted' && denialReason !== null ? <Reason icon={<Lock />}>{denialReason}</Reason> : null}
      {editable && need !== null && gate.edit.allowed ? <Reason icon={<Info />}>{need}</Reason> : null}
      <span className={styles.push} />
      {editable ? (
        <>
          <ReasonHint reason={editReason} visible={false}>
            <Button variant="secondary" loading={pending} onClick={() => submit(false)}>
              {m('btn.saveDraft')}
            </Button>
          </ReasonHint>
          <ReasonHint reason={editReason} visible={false}>
            <Button variant="primary" startIcon={<Send />} loading={pending} onClick={() => submit(true)}>
              {m('btn.submit')}
            </Button>
          </ReasonHint>
        </>
      ) : null}
      {status === 'submitted' && open !== undefined && shown !== undefined ? (
        <>
          <ReasonHint reason={denialReason} visible={false}>
            <Button variant="secondary" startIcon={<X />} onClick={() => open.denial === null && setDeciding('reject')}>
              {t('common.reject')}
            </Button>
          </ReasonHint>
          <ReasonHint reason={denialReason} visible={false}>
            <Button variant="primary" startIcon={<Check />} onClick={() => open.denial === null && setDeciding('approve')}>
              {t('common.approve')}
            </Button>
          </ReasonHint>
        </>
      ) : null}
      {status === 'active' && open !== undefined && shown !== undefined && !ruleRetired ? (
        <>
          {working === null ? (
            <ReasonHint reason={gate.edit.reason} visible={false}>
              <Button variant="secondary" startIcon={<GitBranch />} loading={version.pending} onClick={() => gate.edit.allowed && version.run({ rule_code: open.rule.code, version: shown.version })}>
                {m('btn.newVersion')}
              </Button>
            </ReasonHint>
          ) : null}
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" onClick={() => gate.edit.allowed && setRetiring(true)}>
              {m('btn.retire')}
            </Button>
          </ReasonHint>
        </>
      ) : null}
      {status === 'rejected' && open !== undefined && shown !== undefined && working === null && !ruleRetired ? (
        <ReasonHint reason={gate.edit.reason} visible={false}>
          <Button variant="primary" loading={version.pending} onClick={() => gate.edit.allowed && version.run({ rule_code: open.rule.code, version: shown.version })}>
            {m('btn.revise')}
          </Button>
        </ReasonHint>
      ) : null}
    </div>
  );

  return (
    <>
      <RecordDrawer
        open
        param="rule"
        closeAlso={['version']}
        recordKey={recordKey}
        title={isNew ? m('title.new') : <span translate="no">{open?.rule.code}</span>}
        subtitle={isNew || open === undefined ? undefined : <RuleName name={open.rule.name} nameAr={open.rule.nameAr} />}
        footer={footer}
      >
        <Stack gap={20}>
          {isNew || shown === undefined ? null : (
            <div className={styles.pills}>
              <StatusBadge status={status} />
              <span className={styles.versionBadge}>{m('v.label', { n: shown.version })}</span>
              <OutcomeTag outcome={shown.outcome} />
            </div>
          )}
          {isNew && assistant !== undefined ? (
            <RuleDraftBlock
              action={draftRuleFromText}
              configured={assistant.configured}
              editReason={gate.edit.reason ?? null}
              onDraft={(draft) =>
                change({
                  name: draft.name_en,
                  nameAr: draft.name_ar ?? '',
                  match: draft.condition.match,
                  rows: draftsOf(draft.condition),
                  conditionText: draft.condition_text_en,
                  outcome: draft.outcome,
                })
              }
            />
          ) : null}
          {isNew ? (
            <Field label={m('col.rule')} required>
              <Input value={form.code} placeholder="RULE-010" autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ code: event.target.value })} />
            </Field>
          ) : null}
          <Field label={m('f.name')} required>
            <Input value={form.name} disabled={!isNew || fieldsDisabled} autoComplete="off" translate="no" onChange={(event) => change({ name: event.target.value })} />
          </Field>
          <Field label={m('f.ar.label')} hint={m('f.ar.hint')}>
            <Input value={form.nameAr} disabled={!isNew || fieldsDisabled} autoComplete="off" lang="ar" dir="rtl" onChange={(event) => change({ nameAr: event.target.value })} />
          </Field>
          <ConditionBuilder match={form.match} onMatch={(match) => change({ match })} rows={form.rows} onRows={(rows) => change({ rows })} caseTypes={caseTypes} caseTypeLabels={caseTypeLabels} disabled={fieldsDisabled} />
          <Field label={m('col.cond')} required>
            <Input value={form.conditionText} disabled={fieldsDisabled} autoComplete="off" translate="no" onChange={(event) => change({ conditionText: event.target.value })} />
          </Field>
          <Field label={m('col.outcome')}>
            <RadioGroup
              name={outcomeName}
              orientation="horizontal"
              value={form.outcome}
              disabled={fieldsDisabled}
              options={OUTCOMES.map((outcome) => ({ value: outcome, label: m(`out.${outcome}`) }))}
              onChange={(next) => {
                const outcome = OUTCOMES.find((o) => o === next);
                if (outcome !== undefined) change({ outcome });
              }}
            />
          </Field>
          <div className={styles.dates}>
            <Field label={m('col.eff')}>
              <DateInput value={form.from} disabled={fieldsDisabled} translate="no" dir="ltr" onChange={(event) => change({ from: event.target.value })} />
            </Field>
            <Field label={m('f.to')}>
              <DateInput value={form.to} disabled={fieldsDisabled} translate="no" dir="ltr" onChange={(event) => change({ to: event.target.value })} />
            </Field>
          </div>
          {editable ? null : <Reason icon={<Lock />}>{m('locked')}</Reason>}
          {open?.rule.sourceNote ? <DescriptionList dense columns={1} items={[{ label: m('d.source'), value: <span translate="no">{open.rule.sourceNote}</span> }]} /> : null}
          {open === undefined ? null : (
            <>
              <Stack gap={8}>
                <h3 className={styles.sectionTitle}>{m('d.versions')}</h3>
                <VersionList versions={open.versions} shown={open.shown} />
              </Stack>
              <Stack gap={8}>
                <h3 className={styles.sectionTitle}>{m('d.history')}</h3>
                <History items={open.history} />
              </Stack>
            </>
          )}
          <ActionError error={error ?? version.error} onDismiss={() => {
            save.reset();
            saveExisting.reset();
            version.reset();
          }} />
        </Stack>
      </RecordDrawer>
      {open === undefined || shown === undefined ? null : (
        <DecisionDialog open={deciding !== null} kind={deciding ?? 'approve'} code={open.rule.code} version={shown.version} onClose={() => setDeciding(null)} onDone={() => setDeciding(null)} />
      )}
      <ConfirmDialog
        open={retiring}
        onClose={() => {
          setRetiring(false);
          retire.reset();
        }}
        onConfirm={() => open !== undefined && retire.run({ rule_code: open.rule.code, note: '' })}
        title={m('retire.title', { code: open?.rule.code ?? '' })}
        description={m('retire.desc')}
        confirmLabel={m('btn.retire')}
        tone="danger"
        pending={retire.pending}
        error={<ActionError error={retire.error} onDismiss={retire.reset} />}
      />
    </>
  );
}

/** The versions of the rule, each with its status and dates; pressing one shows it in the drawer (`?version=`). */
function VersionList({ versions, shown }: { versions: readonly VersionRow[]; shown: number }) {
  const m = useTranslations('admin.classification_rules');
  const format = useFormat();
  const url = useUrlState();
  return (
    <div className={styles.versions}>
      {[...versions].reverse().map((v) => (
        <div key={v.version} className={styles.versionItem}>
          <Button variant="link" size="sm" aria-current={v.version === shown ? 'true' : undefined} onClick={() => url.update({ version: String(v.version) }, { history: 'replace', keepPage: true })}>
            {m('v.label', { n: v.version })}
          </Button>
          <StatusBadge status={v.status} />
          <span className={styles.meta}>{v.effectiveFrom === null ? m('eff.none') : `${format.date(v.effectiveFrom)} - ${v.effectiveTo === null ? m('eff.open') : format.date(v.effectiveTo)}`}</span>
        </div>
      ))}
    </div>
  );
}
