'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Badge, Button, Card, CardHeader, DescriptionList, Field, Input, Select, SegmentedControl, Stack, Tag, Textarea } from '@opendispatch/ui';
import { Info, Lock, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ZonePicker } from '@/components/opendispatch/patterns/ZonePicker';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { isRole, scopeAppliesTo, type Role } from '@/lib/access';
import { previewRules, removeRule, saveRule, setRuleEnabled } from './actions';
import styles from './SignIn.module.css';
import type { MatchType, PickerZone, PreviewResult, RoleOption, RuleRow } from './types';

// The Group rules tab: the rules table with its On switches, the preview (which role and zones a list of groups gets, and which
// rules matched: no matching rule means no access), and the rule editor drawer (`?rule=<id>` or `?rule=new`). A
// view-only Administrator (a shared install) sees every control disabled with "Managed by our staff in the shared tier".

const MATCH_TYPES: readonly MatchType[] = ['exact', 'object_id', 'prefix'];
const DEBOUNCE_MS = 300;

/** Zone codes as gray tags, the first three, then "+N" (the mockup's zone cell). */
export function ZoneTagList({ codes, limit = 3 }: { codes: readonly string[]; limit?: number }) {
  return (
    <span className={styles.zoneTags}>
      {codes.slice(0, limit).map((code) => (
        <Tag key={code} color="gray">
          <span translate="no">{code}</span>
        </Tag>
      ))}
      {codes.length > limit ? (
        <Badge size="sm" tone="neutral">
          <bdi dir="ltr" translate="no">
            +{codes.length - limit}
          </bdi>
        </Badge>
      ) : null}
    </span>
  );
}

/** The scope of a role in words, or its zones when it is limited to some. */
export function ScopeCell({ role, codes }: { role: Role; codes: readonly string[] }) {
  const t = useTranslations();
  const scope = scopeAppliesTo(role);
  return scope === 'assigned_zones' ? <ZoneTagList codes={codes} /> : <>{t(`scopes.${scope}`)}</>;
}

/** The On switch of a rule row (a client element the server places in a cell). */
export function RuleToggle({ ruleId, enabled, canEdit }: { ruleId: string; enabled: boolean; canEdit: boolean }) {
  const m = useTranslations('admin.sign_in_identity');
  const toggle = useAdminAction(setRuleEnabled, { successTitle: m('toast.rule'), successDescription: (saved) => saved.match, failureToast: true });
  return (
    <ReasonSwitch
      reason={canEdit ? null : m('ro.reason')}
      checked={enabled}
      aria-label={m('col.on')}
      onCheckedChange={(next) => {
        if (canEdit) toggle.run({ ruleId, enabled: next });
      }}
    />
  );
}

export interface RulesPanelProps {
  readonly columns: readonly AdminTableColumn[];
  /** The rows as the server built them; the preview tints the ones that matched. */
  readonly rows: readonly AdminTableRow[];
  readonly rules: readonly RuleRow[];
  readonly caption: string;
  readonly samples: readonly string[];
  readonly initialGroups: string;
  readonly initialPreview: PreviewResult;
  readonly canEdit: boolean;
}

const parseGroups = (text: string): string[] => text.split(/[\n,]+/).map((group) => group.trim()).filter((group) => group !== '');

export function RulesPanel({ columns, rows, rules, caption, samples, initialGroups, initialPreview, canEdit }: RulesPanelProps) {
  const m = useTranslations('admin.sign_in_identity');
  const t = useTranslations();
  const url = useUrlState();
  const [groups, setGroups] = useState(initialGroups);
  const [preview, setPreview] = useState<PreviewResult>(initialPreview);
  // The groups the shown preview answers, so a change made while a call is running is asked again when it ends.
  const answered = useRef(initialGroups);

  const ask = useAdminAction(previewRules, {
    quiet: true,
    onSuccess: (result) => setPreview(result),
  });
  const run = ask.run;
  const pending = ask.pending;

  useEffect(() => {
    if (groups === answered.current || pending) return undefined;
    const timer = setTimeout(() => {
      answered.current = groups;
      run({ groups: parseGroups(groups) });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [groups, pending, run]);

  const matched = useMemo(() => new Set(preview.matchedIds), [preview]);
  const shownRows = rows.map((row) => (matched.has(row.id) ? { ...row, tone: 'success' as const } : row));
  const matchedPriorities = rules.filter((rule) => matched.has(rule.id)).map((rule) => rule.priority);

  return (
    <div className={styles.detailGrid}>
      <Card padding="none">
        <CardHeader
          title={m('tab.rules')}
          subtitle={m('rules.sub')}
          actions={
            <ReasonHint reason={canEdit ? null : m('ro.reason')} visible={false}>
              <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => canEdit && url.update({ rule: 'new' }, { history: 'push' })}>
                {m('rule.add')}
              </Button>
            </ReasonHint>
          }
        />
        <AdminTable caption={caption} columns={[...columns]} rows={shownRows} rowParam="rule" pageSize={0} />
      </Card>
      <aside className={styles.col}>
        <Card padding="lg">
          <Stack gap={12}>
            <h2 className={styles.sectionTitle}>{m('prev.title')}</h2>
            <Field label={m('prev.groups')}>
              <Textarea value={groups} rows={3} translate="no" dir="ltr" onChange={(event) => setGroups(event.target.value)} />
            </Field>
            <div className={styles.samples}>
              {samples.map((sample) => (
                <Button key={sample} variant="secondary" size="sm" onClick={() => setGroups(sample)}>
                  <span translate="no" dir="ltr">
                    {sample.length > 22 ? `${sample.slice(0, 13)}...${sample.slice(-2)}` : sample}
                  </span>
                </Button>
              ))}
            </div>
            <div className={styles.previewResult} aria-live="polite">
              {preview.role === null ? (
                <Alert tone="warning" icon={<Lock />} title={m('prev.none')} />
              ) : (
                <DescriptionList
                  dense
                  columns={1}
                  items={[
                    { label: m('prev.role'), value: t(`roles.${preview.role}`) },
                    { label: t('common.zone'), value: <PreviewZones role={preview.role} codes={preview.zoneCodes} /> },
                    { label: m('prev.match', { n: preview.matchedIds.length }), value: <span translate="no">{matchedPriorities.map((priority) => `#${priority}`).join(', ')}</span> },
                  ]}
                />
              )}
            </div>
          </Stack>
        </Card>
      </aside>
    </div>
  );
}

function PreviewZones({ role, codes }: { role: Role; codes: readonly string[] }): ReactNode {
  return <ScopeCell role={role} codes={codes} />;
}

// ---------------------------------------------------------------------------------------------
// The rule editor
// ---------------------------------------------------------------------------------------------

export interface RuleDrawerProps {
  /** The rule `?rule=` names, or `new`; undefined: closed. The parent gives the component a `key` for it. */
  readonly rule: RuleRow | 'new' | undefined;
  readonly zones: readonly PickerZone[];
  readonly roleOptions: readonly RoleOption[];
  readonly nextPriority: number;
  readonly canEdit: boolean;
}

export function RuleDrawer({ rule, zones, roleOptions, nextPriority, canEdit }: RuleDrawerProps) {
  const m = useTranslations('admin.sign_in_identity');
  const t = useTranslations();
  const url = useUrlState();
  const existing = rule === 'new' || rule === undefined ? undefined : rule;
  const [match, setMatch] = useState(existing?.match ?? '');
  const [type, setType] = useState<MatchType>(existing?.matchType ?? 'exact');
  const [role, setRole] = useState<Role>(existing?.role ?? 'dispatcher');
  const [zoneIds, setZoneIds] = useState<string[]>([...(existing?.zoneIds ?? [])]);
  const [priority, setPriority] = useState(String(existing?.priority ?? nextPriority));
  const [confirming, setConfirming] = useState(false);

  const close = () => url.update({ rule: null }, { history: 'replace' });
  const save = useAdminAction(saveRule, { successTitle: m('toast.rule'), successDescription: (saved) => saved.match, onSuccess: close });
  const remove = useAdminAction(removeRule, { successTitle: m('toast.ruleDel'), onSuccess: () => { setConfirming(false); close(); } });

  if (rule === undefined) return <RecordDrawer open={false} param="rule" title="" />;

  const assigned = scopeAppliesTo(role) === 'assigned_zones';
  const roReason = canEdit ? null : m('ro.reason');
  const need = match.trim() === '' ? m('need.group') : assigned && zoneIds.length === 0 ? m('need.zone') : null;
  const gate = roReason ?? need;

  const footer = (
    <div className={styles.footer}>
      {need === null || roReason !== null ? null : <Reason icon={<Info />}>{need}</Reason>}
      {existing === undefined ? null : (
        <ReasonHint reason={roReason} visible={false}>
          <Button variant="ghost" onClick={() => roReason === null && setConfirming(true)}>
            {m('rule.del')}
          </Button>
        </ReasonHint>
      )}
      <span className={styles.push} />
      <Button variant="ghost" onClick={close}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate} visible={false}>
        <Button
          variant="primary"
          loading={save.pending}
          onClick={() => {
            if (gate === null) save.run({ ...(existing === undefined ? {} : { ruleId: existing.id }), group_match: match.trim(), group_match_type: type, assigned_role: role, zone_ids: assigned ? zoneIds : [], priority: Number.parseInt(priority, 10) || 1 });
          }}
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <>
      <RecordDrawer open recordKey={existing?.id ?? 'new'} param="rule" title={m(existing === undefined ? 'rule.add' : 'rule.edit')} footer={footer}>
        <Stack gap={16}>
          <Field label={m('col.group')} required>
            <Input value={match} autoComplete="off" translate="no" dir="ltr" disabled={!canEdit} onChange={(event) => setMatch(event.target.value)} />
          </Field>
          <Field label={m('r.type')}>
            <SegmentedControl
              size="sm"
              ariaLabel={m('r.type')}
              value={type}
              options={MATCH_TYPES.map((option) => ({ value: option, label: m(`match.${option}`) }))}
              onChange={(next) => {
                if ((MATCH_TYPES as readonly string[]).includes(next)) setType(next as MatchType);
              }}
            />
          </Field>
          <Field label={m('prev.role')}>
            <Select
              value={role}
              disabled={!canEdit}
              options={roleOptions.map((option) => ({ value: option.role, label: option.availableHere ? t(`roles.${option.role}`) : `${t(`roles.${option.role}`)} (${m('private')})`, disabled: !option.availableHere }))}
              onChange={(event) => {
                if (isRole(event.target.value)) setRole(event.target.value);
              }}
            />
          </Field>
          <ZonePicker legend={t('common.zone')} zones={zones} value={zoneIds} onChange={setZoneIds} disabled={!canEdit || !assigned} required={assigned} disabledHint={canEdit ? m('zones.none') : m('ro.reason')} />
          <div className={styles.narrow}>
            <Field label={m('col.priority')}>
              <Input type="number" min={1} step={1} value={priority} translate="no" disabled={!canEdit} onChange={(event) => setPriority(event.target.value)} />
            </Field>
          </div>
          <ActionError error={save.error} onDismiss={save.reset} />
        </Stack>
      </RecordDrawer>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          remove.reset();
        }}
        onConfirm={() => existing !== undefined && remove.run({ ruleId: existing.id })}
        title={m('rule.delTitle')}
        description={m('rule.delDesc')}
        confirmLabel={m('rule.del')}
        tone="danger"
        pending={remove.pending}
        error={<ActionError error={remove.error} onDismiss={remove.reset} />}
      />
    </>
  );
}
