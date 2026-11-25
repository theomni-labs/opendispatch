'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Field, Input, Menu, Modal, QuantityInput, RadioGroup, SegmentedControl, Select, Stack, Switch, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Info, Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { saveCsv } from '@/lib/export/download';
import { saveBreakRule, savePattern, savePrayerPolicy } from './actions';
import { PRAYER_POLICIES, PRAYER_WINDOWS, type BreakRow, type PatternRow, type PrayerPolicyMode } from './types';
import styles from './ShiftBreakPolicies.module.css';

// The forms of the Shift and Break Policies screen: the header (Add pattern, More: Edit break rule,
// Export), the pattern drawer, the break rule dialog, and the Ramadan switch, which is fixed On and labelled "Not applied"
//.
// Every write is a server action through useAdminAction; the data layer authorises, validates and audits, and a role without
// `edit` sees the same controls disabled with the reason. Nothing here names the caller.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The label of a break rule: the mockup's "Standard" and "Ramadan hours" for its two codes, the rule's own name for any other. */
export function useBreakLabel() {
  const m = useTranslations('admin.shift_break_policies');
  const locale = useLocale();
  return (rule: BreakRow): string => (rule.code === 'BRK-STD' ? m('brk.std') : rule.code === 'BRK-RAM' ? m('brk.ram') : locale === 'ar' && rule.nameAr ? rule.nameAr : rule.name);
}

// ---------------------------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------------------------

export function AddPatternButton({ canEdit, variant = 'primary' }: { canEdit: boolean; variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('admin.shift_break_policies');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ pattern: 'new' }, { history: 'push', keepPage: true })}>
        {m('add')}
      </Button>
    </ReasonHint>
  );
}

/** The break rule card's Edit (opens ?break=1). */
export function EditBreakRuleButton({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.shift_break_policies');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant="ghost" size="sm" startIcon={<Pencil />} onClick={() => gate.edit.allowed && url.update({ break: '1' }, { history: 'push', keepPage: true })}>
        {m('edit')}
      </Button>
    </ReasonHint>
  );
}

export interface HeaderProps {
  readonly canEdit: boolean;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** The patterns on screen as CSV cells; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

/** The two header actions: Add pattern (primary) and More (Edit break rule, Export). */
export function ShiftsHeader({ canEdit, exportFilename, exportHeader, exportRows }: HeaderProps) {
  const m = useTranslations('admin.shift_break_policies');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const items: MenuEntry[] = [
    ...(gate.edit.reason === null ? [] : [{ type: 'heading', label: gate.edit.reason } as const]),
    { label: m('menu.breakRule'), icon: <Pencil />, disabled: !gate.edit.allowed || exportRows === undefined, onSelect: () => url.update({ break: '1' }, { history: 'push', keepPage: true }) },
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
      <AddPatternButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The pattern drawer
// ---------------------------------------------------------------------------------------------

interface HoursForm {
  readonly applies: boolean;
  readonly start: string;
  readonly end: string;
}

interface PatternForm {
  readonly name: string;
  readonly code: string;
  readonly kind: 'field' | 'remote';
  readonly normal: HoursForm;
  readonly ramadan: HoursForm;
  readonly breakRuleId: string;
  readonly status: 'active' | 'draft';
}

const hoursForm = (hours: { readonly start: string; readonly end: string } | null, start: string, end: string): HoursForm => (hours === null ? { applies: false, start, end } : { applies: true, start: hours.start, end: hours.end });

function patternForm(row: PatternRow | undefined, breaks: readonly BreakRow[]): PatternForm {
  // A new pattern starts as the mockup has it: both hour groups on and the times empty, so Save says "Check the times" until they are entered.
  if (row === undefined) return { name: '', code: '', kind: 'field', normal: { applies: true, start: '', end: '' }, ramadan: { applies: true, start: '', end: '' }, breakRuleId: breaks[0]?.id ?? '', status: 'draft' };
  return { name: row.name, code: row.code, kind: row.kind, normal: hoursForm(row.normal, '06:00', '14:00'), ramadan: hoursForm(row.ramadan, '06:00', '12:00'), breakRuleId: row.breakRuleId, status: row.status };
}

const hoursOk = (hours: HoursForm): boolean => !hours.applies || (TIME.test(hours.start) && TIME.test(hours.end) && hours.start !== hours.end);

export interface PatternDrawerProps {
  /** The pattern `?pattern=` opens; undefined for `new` and for an id that does not exist. */
  readonly pattern: PatternRow | undefined;
  /** `?pattern=new` and the person may edit. Decided on the server. */
  readonly isNew: boolean;
  readonly canEdit: boolean;
  readonly breaks: readonly BreakRow[];
  /** The codes in use, to say a duplicate before the data layer does. */
  readonly codes: readonly string[];
}

export function PatternDrawer({ pattern, isNew, canEdit, breaks, codes }: PatternDrawerProps) {
  const m = useTranslations('admin.shift_break_policies');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const breakLabel = useBreakLabel();
  const open = pattern !== undefined || isNew;
  const key = !open ? '' : pattern === undefined ? 'new' : pattern.id;
  const [seen, setSeen] = useState(key);
  const [form, setForm] = useState<PatternForm>(() => patternForm(pattern, breaks));
  if (key !== seen) {
    setSeen(key);
    setForm(patternForm(pattern, breaks));
  }
  const save = useAdminAction(savePattern, {
    successTitle: (result) => (result.created ? m('toast.created', { code: result.code }) : result.status === 'draft' ? m('toast.draft') : m('toast.updated', { code: result.code })),
    onSuccess: () => url.update({ pattern: null }, { history: 'replace', keepPage: true }),
  });
  if (!open) return <RecordDrawer open={false} param="pattern" title="" />;

  const change = (patch: Partial<PatternForm>) => {
    save.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const need =
    form.name.trim() === ''
      ? m('need.name')
      : isNew && form.code.trim() === ''
        ? m('need.code')
        : isNew && codes.includes(form.code.trim())
          ? m('need.dup')
          : !hoursOk(form.normal) || !hoursOk(form.ramadan)
            ? m('need.times')
            : null;
  const readOnly = !gate.edit.allowed;

  function submit() {
    if (!gate.edit.allowed || need !== null) return;
    const hours = (h: HoursForm) => ({ applies: h.applies, start_time: h.start, end_time: h.end });
    save.run({ ...(pattern === undefined ? {} : { targetId: pattern.id }), name_en: form.name.trim(), code: form.code.trim(), kind: form.kind, normal: hours(form.normal), ramadan: hours(form.ramadan), break_rule_id: form.breakRuleId, status: form.status });
  }

  const footer = (
    <div className={styles.footer}>
      {need === null || readOnly ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ pattern: null }, { history: 'replace', keepPage: true })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate.edit.reason ?? need} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={submit}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  const hoursGroup = (label: string, which: 'normal' | 'ramadan') => {
    const value = form[which];
    return (
      <Stack gap={8}>
        <div className={styles.hoursHead}>
          <span className={styles.label}>{label}</span>
          <Switch checked={value.applies} disabled={readOnly} label={m('dr.applies')} onCheckedChange={(applies) => change({ [which]: { ...value, applies } })} />
        </div>
        {value.applies ? (
          <div className={styles.pair}>
            <Field label={m('dr.from')}>
              <Input type="time" value={value.start} disabled={readOnly} dir="ltr" translate="no" onChange={(event) => change({ [which]: { ...value, start: event.target.value } })} />
            </Field>
            <Field label={m('dr.to')}>
              <Input type="time" value={value.end} disabled={readOnly} dir="ltr" translate="no" onChange={(event) => change({ [which]: { ...value, end: event.target.value } })} />
            </Field>
          </div>
        ) : null}
      </Stack>
    );
  };

  return (
    <RecordDrawer open param="pattern" recordKey={key} title={pattern === undefined ? m('dr.new') : m('dr.edit')} subtitle={pattern === undefined ? undefined : <span translate="no">{pattern.code}</span>} footer={footer}>
      <Stack gap={16}>
        <Field label={m('dr.name')} required>
          <Input value={form.name} disabled={readOnly} autoComplete="off" translate="no" onChange={(event) => change({ name: event.target.value })} />
        </Field>
        {isNew ? (
          <Field label={m('dr.code')} required>
            <Input value={form.code} disabled={readOnly} autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ code: event.target.value })} />
          </Field>
        ) : null}
        <Field label={m('col.kind')}>
          <SegmentedControl
            ariaLabel={m('col.kind')}
            value={form.kind}
            options={[
              { value: 'field', label: m('kind.field') },
              { value: 'remote', label: m('kind.remote') },
            ]}
            onChange={(next) => !readOnly && change({ kind: next === 'remote' ? 'remote' : 'field' })}
          />
        </Field>
        {hoursGroup(m('col.normal'), 'normal')}
        {hoursGroup(m('col.ramadan'), 'ramadan')}
        <Field label={m('col.break')}>
          <Select value={form.breakRuleId} disabled={readOnly} options={breaks.map((b) => ({ value: b.id, label: `${breakLabel(b)}: ${m('brk.short', { m: b.minutes, h: b.afterHours })}` }))} onChange={(event) => change({ breakRuleId: event.target.value })} />
        </Field>
        <Field label={t('common.status')}>
          <SegmentedControl
            ariaLabel={t('common.status')}
            value={form.status}
            options={[
              { value: 'draft', label: m('status.draft') },
              { value: 'active', label: m('status.active') },
            ]}
            onChange={(next) => !readOnly && change({ status: next === 'active' ? 'active' : 'draft' })}
          />
        </Field>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// The break rule dialog
// ---------------------------------------------------------------------------------------------

export function BreakDialog({ open, canEdit, breaks }: { open: boolean; canEdit: boolean; breaks: readonly BreakRow[] }) {
  const m = useTranslations('admin.shift_break_policies');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const breakLabel = useBreakLabel();
  const [ruleId, setRuleId] = useState(breaks[0]?.id ?? '');
  const chosen = breaks.find((b) => b.id === ruleId) ?? breaks[0];
  const [after, setAfter] = useState(chosen?.afterHours ?? 5);
  const [minutes, setMinutes] = useState(chosen?.minutes ?? 30);
  const [dismissed, setDismissed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setRuleId(breaks[0]?.id ?? '');
    setAfter(breaks[0]?.afterHours ?? 5);
    setMinutes(breaks[0]?.minutes ?? 30);
    if (!open) setDismissed(false);
  }
  const close = () => {
    setDismissed(true);
    url.update({ break: null }, { history: 'replace', keepPage: true });
  };
  const save = useAdminAction(saveBreakRule, { successTitle: m('toast.breakSaved'), onSuccess: close });
  const pick = (id: string) => {
    const rule = breaks.find((b) => b.id === id);
    setRuleId(id);
    if (rule !== undefined) {
      setAfter(rule.afterHours);
      setMinutes(rule.minutes);
    }
  };
  return (
    <Modal
      open={open && !dismissed && chosen !== undefined}
      onClose={close}
      size="sm"
      title={m('brk.title')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button
              variant="primary"
              loading={save.pending}
              onClick={() => {
                if (gate.edit.allowed && chosen !== undefined) save.run({ targetId: chosen.id, break_minutes: minutes, after_consecutive_hours: after });
              }}
            >
              {t('common.save')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <Field label={m('brk.rule')}>
          <Select value={ruleId} disabled={!gate.edit.allowed} options={breaks.map((b) => ({ value: b.id, label: breakLabel(b) }))} onChange={(event) => pick(event.target.value)} />
        </Field>
        <div className={styles.pair}>
          <Field label={m('brk.after')}>
            <QuantityInput value={after} min={0.5} max={12} step={0.5} uom={m('uom.h')} disabled={!gate.edit.allowed} onChange={setAfter} />
          </Field>
          <Field label={m('brk.length')}>
            <QuantityInput value={minutes} min={1} max={180} step={5} uom={t('common.minShort')} disabled={!gate.edit.allowed} onChange={setMinutes} />
          </Field>
        </div>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// The Ramadan switch: a stub
// ---------------------------------------------------------------------------------------------

/** "Use in the Ramadan window": fixed On and labelled "Not applied". The data layer applies Ramadan hours whenever the date is in Ramadan. */
export function RamadanSwitch() {
  const m = useTranslations('admin.shift_break_policies');
  return (
    <div className={styles.switchRow}>
      <Switch checked disabled label={m('ram.auto')} onCheckedChange={() => undefined} />
      <StubTag kind="notApplied" />
    </div>
  );
}

// Breaks and prayer: saved on change, audited

export interface PrayerPolicyFieldsProps {
  readonly mode: PrayerPolicyMode;
  readonly windowMinutes: number;
  readonly canEdit: boolean;
}

export function PrayerPolicyFields({ mode, windowMinutes, canEdit }: PrayerPolicyFieldsProps) {
  const m = useTranslations('admin.shift_break_policies');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const name = useId();
  const label = (value: PrayerPolicyMode) => m(value === 'clear_of_prayer' ? 'pr.clear' : 'pr.linedUp');
  const save = useAdminAction(savePrayerPolicy, {
    successTitle: m('toast.prayer'),
    successDescription: (saved) => `${label(saved.mode)} · ${m('pr.min', { n: saved.windowMinutes })}`,
  });
  const windows = PRAYER_WINDOWS.includes(windowMinutes) ? PRAYER_WINDOWS : [...PRAYER_WINDOWS, windowMinutes].sort((a, b) => a - b);
  return (
    <div className={styles.stack}>
      <Field label={m('pr.label')}>
        <RadioGroup
          name={name}
          value={mode}
          disabled={!canEdit || save.pending}
          onChange={(next) => {
            const chosen = PRAYER_POLICIES.find((p) => p === next);
            if (chosen !== undefined && chosen !== mode && gate.edit.allowed) save.run({ prayer_policy: chosen });
          }}
          options={PRAYER_POLICIES.map((value) => ({ value, label: label(value), ...(value === 'clear_of_prayer' ? { description: m('pr.default') } : {}) }))}
        />
      </Field>
      <Field label={m('pr.window')}>
        <Select
          value={String(windowMinutes)}
          disabled={!canEdit || save.pending}
          onChange={(event) => {
            const chosen = Number(event.target.value);
            if (Number.isInteger(chosen) && chosen !== windowMinutes && gate.edit.allowed) save.run({ prayer_window_minutes: chosen });
          }}
          options={windows.map((n) => ({ value: String(n), label: m('pr.min', { n }) }))}
        />
      </Field>
      <ActionError error={save.error} onDismiss={save.reset} />
      {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
    </div>
  );
}
