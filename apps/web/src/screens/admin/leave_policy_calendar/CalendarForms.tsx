'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, DateInput, Field, Input, Menu, Modal, QuantityInput, Select, Stack, Tag, useFormat, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Info, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { addDays } from '@/components/opendispatch/month-grid-geometry';
import { saveCsv } from '@/lib/export/download';
import { recomputePrayer, removeHoliday, saveHoliday, savePolicy } from './actions';
import { HOLIDAY_KINDS, type Blackout, type HolidayKind, type HolidayRow, type PolicyData } from './types';
import styles from './LeavePolicyCalendar.module.css';

// The forms of the Leave Policy and Calendar screen: the header (Add holiday, More: Recompute prayer
// times, Export), the holiday dialog, and the leave policy form with its "Add period" dialog. Every write is a server action
// through useAdminAction; the data layer authorises, validates and audits, and a role without `edit` sees the same controls
// disabled with the reason. Dates are the design system's DateInput (a native date input with the Hijri date under it).
// Nothing here names the caller.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------------------------

export function AddHolidayButton({ canEdit, variant = 'primary' }: { canEdit: boolean; variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ holiday: 'new' }, { history: 'push', keepPage: true })}>
        {m('add')}
      </Button>
    </ReasonHint>
  );
}

export interface HeaderProps {
  readonly canEdit: boolean;
  /** The day the prayer times are recomputed from: a week of seven days starting there. */
  readonly recomputeFrom: string;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** The holidays on screen as CSV cells; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

/** The two header actions: Add holiday (primary) and More (Recompute prayer times, Export). */
export function CalendarHeader({ canEdit, recomputeFrom, exportFilename, exportHeader, exportRows }: HeaderProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const recompute = useAdminAction(recomputePrayer, {
    successTitle: m('toast.recomputed.title'),
    successDescription: (result) => m('toast.recomputed.desc', { cities: result.cities, days: result.days, records: result.records }),
    failureToast: true,
  });
  const items: MenuEntry[] = [
    ...(gate.edit.reason === null ? [] : [{ type: 'heading', label: gate.edit.reason } as const]),
    { label: m('menu.recompute'), icon: <RefreshCw />, disabled: !gate.edit.allowed || exportRows === undefined, onSelect: () => recompute.run({ date_from: recomputeFrom, date_to: addDays(recomputeFrom, 6) }) },
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
      <AddHolidayButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The holiday dialog
// ---------------------------------------------------------------------------------------------

interface HolidayForm {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly from: string;
  readonly to: string;
  readonly kind: HolidayKind;
}

const holidayForm = (row: HolidayRow | undefined, today: string): HolidayForm => (row === undefined ? { nameEn: '', nameAr: '', from: today, to: today, kind: 'public' } : { nameEn: row.nameEn, nameAr: row.nameAr ?? '', from: row.from, to: row.to, kind: row.kind });

export interface HolidayModalProps {
  /** The holiday `?holiday=` opens; undefined for `new` and for an id that does not exist. */
  readonly holiday: HolidayRow | undefined;
  /** `?holiday=new` and the person may edit. Decided on the server. */
  readonly isNew: boolean;
  readonly canEdit: boolean;
  readonly today: string;
}

export function HolidayModal({ holiday, isNew, canEdit, today }: HolidayModalProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const open = holiday !== undefined || isNew;
  const key = !open ? '' : holiday === undefined ? 'new' : holiday.id;
  const [seen, setSeen] = useState(key);
  const [form, setForm] = useState<HolidayForm>(() => holidayForm(holiday, today));
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (key !== seen) {
    setSeen(key);
    setForm(holidayForm(holiday, today));
    setDismissed(false);
    setConfirming(false);
  }
  const close = () => {
    setDismissed(true);
    url.update({ holiday: null }, { history: 'replace', keepPage: true });
  };
  const save = useAdminAction(saveHoliday, {
    successTitle: (result) => m(result.created ? 'toast.created' : 'toast.updated', { name: result.name }),
    onSuccess: close,
  });
  const remove = useAdminAction(removeHoliday, {
    successTitle: (result) => m('toast.deleted', { name: result.name }),
    onSuccess: () => {
      setConfirming(false);
      close();
    },
  });
  const change = (patch: Partial<HolidayForm>) => {
    save.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const need = form.nameEn.trim() === '' ? m('need.name') : !DATE.test(form.from) || !DATE.test(form.to) ? m('need.dates') : form.to < form.from ? m('need.order') : null;
  const reason = gate.edit.reason ?? need;
  const readOnly = !gate.edit.allowed;

  return (
    <>
      <Modal
        open={open && !dismissed}
        onClose={close}
        size="sm"
        title={holiday === undefined ? m('h.new') : m('h.edit')}
        footer={
          <div className={styles.footer}>
            {holiday === undefined ? null : (
              <ReasonHint reason={gate.edit.reason} visible={false}>
                <Button variant="secondary" startIcon={<Trash2 />} onClick={() => gate.edit.allowed && setConfirming(true)}>
                  {m('h.delete')}
                </Button>
              </ReasonHint>
            )}
            {need === null || readOnly ? null : <Reason icon={<Info />}>{need}</Reason>}
            <span className={styles.push} />
            <Button variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <ReasonHint reason={reason} visible={false}>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={() => {
                  if (reason === null) save.run({ ...(holiday === undefined ? {} : { targetId: holiday.id }), name_en: form.nameEn.trim(), name_ar: form.nameAr.trim(), start_date: form.from, end_date: form.to, kind: form.kind });
                }}
              >
                {t('common.save')}
              </Button>
            </ReasonHint>
          </div>
        }
      >
        <Stack gap={12}>
          <Field label={m('h.nameEn')} required>
            <Input value={form.nameEn} disabled={readOnly} autoComplete="off" translate="no" onChange={(event) => change({ nameEn: event.target.value })} />
          </Field>
          <Field label={m('h.nameAr')}>
            <Input value={form.nameAr} disabled={readOnly} autoComplete="off" lang="ar" dir="rtl" onChange={(event) => change({ nameAr: event.target.value })} />
          </Field>
          <div className={styles.pair}>
            <Field label={m('h.from')} required>
              <DateInput value={form.from} disabled={readOnly} showHijri onChange={(event) => change({ from: event.target.value })} />
            </Field>
            <Field label={m('h.to')} required>
              <DateInput value={form.to} disabled={readOnly} showHijri min={form.from || undefined} onChange={(event) => change({ to: event.target.value })} />
            </Field>
          </div>
          <Field label={m('col.type')}>
            <Select value={form.kind} disabled={readOnly} options={HOLIDAY_KINDS.map((kind) => ({ value: kind, label: m(`kind.${kind}`) }))} onChange={(event) => change({ kind: event.target.value as HolidayKind })} />
          </Field>
          <ActionError error={save.error} onDismiss={save.reset} />
        </Stack>
      </Modal>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          remove.reset();
        }}
        onConfirm={() => holiday !== undefined && remove.run({ targetId: holiday.id })}
        title={m('h.deleteTitle', { name: holiday?.nameEn ?? '' })}
        description={m('h.deleteDesc')}
        confirmLabel={m('h.delete')}
        tone="danger"
        pending={remove.pending}
        error={<ActionError error={remove.error} onDismiss={remove.reset} />}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The leave policy
// ---------------------------------------------------------------------------------------------

export interface PolicyFormProps {
  readonly policy: PolicyData;
  readonly canEdit: boolean;
  /** `?blackout=new`: the "Add period" dialog is open. */
  readonly periodOpen: boolean;
}

const sameBlackouts = (a: readonly Blackout[], b: readonly Blackout[]): boolean => a.length === b.length && a.every((x, i) => x.from === b[i]?.from && x.to === b[i]?.to && x.label === b[i]?.label);

export function PolicyForm({ policy, canEdit, periodOpen }: PolicyFormProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const format = useFormat();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [notice, setNotice] = useState(policy.minNoticeDays);
  const [share, setShare] = useState(policy.sharePercent);
  const [periods, setPeriods] = useState<readonly Blackout[]>(policy.blackouts);
  // What the server holds: the form starts again from it when it changes (after a save, or a change made elsewhere).
  const [held, setHeld] = useState(policy);
  if (held !== policy && JSON.stringify(held) !== JSON.stringify(policy)) {
    setHeld(policy);
    setNotice(policy.minNoticeDays);
    setShare(policy.sharePercent);
    setPeriods(policy.blackouts);
  }
  const dirty = notice !== policy.minNoticeDays || share !== policy.sharePercent || !sameBlackouts(periods, policy.blackouts);
  const save = useAdminAction(savePolicy, { successTitle: m('toast.policy') });
  const readOnly = !gate.edit.allowed;
  const reset = () => {
    setNotice(policy.minNoticeDays);
    setShare(policy.sharePercent);
    setPeriods(policy.blackouts);
    save.reset();
  };
  const reason = gate.edit.reason ?? (dirty ? null : m('l.nochange'));

  return (
    <div className={styles.stack}>
      <div className={styles.title}>
        <h2 className={styles.cardTitle}>{m('l.title')}</h2>
        <IllustrativeLabel />
      </div>
      <div className={styles.pair}>
        <Field label={m('l.notice')}>
          <QuantityInput value={notice} min={0} max={365} step={1} uom={m('uom.days')} disabled={readOnly} onChange={(value) => setNotice(Math.round(value))} />
        </Field>
        <Field label={m('l.share')}>
          <QuantityInput value={share} min={0} max={100} step={1} uom="%" disabled={readOnly} onChange={(value) => setShare(Math.round(value))} />
        </Field>
      </div>
      <Stack gap={8}>
        <div className={styles.calHead}>
          <span className={styles.label}>{m('l.blackout')}</span>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="ghost" size="sm" startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ blackout: 'new' }, { history: 'push', keepPage: true })}>
              {m('l.addPeriod')}
            </Button>
          </ReasonHint>
        </div>
        {periods.length === 0 ? (
          <span className={styles.muted}>{m('l.none')}</span>
        ) : (
          <div className={styles.chips}>
            {periods.map((period, index) => (
              <Tag key={`${period.from}-${index}`} color="gold" {...(readOnly ? {} : { onRemove: () => setPeriods(periods.filter((_, i) => i !== index)) })}>
                <span translate="no">{`${period.label} · ${format.date(period.from)} - ${format.date(period.to)}`}</span>
              </Tag>
            ))}
          </div>
        )}
      </Stack>
      {/* The mockup draws the unsaved changes row inline in this card (not the design system's sticky FormFooter). */}
      <div className={styles.footer}>
        {dirty ? <Reason icon={<Info />}>{m('l.unsaved')}</Reason> : null}
        <span className={styles.push} />
        <Button variant="ghost" disabled={!dirty} onClick={reset}>
          {m('l.reset')}
        </Button>
        <ReasonHint reason={reason} visible={false}>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={() => {
              if (reason === null) save.run({ min_notice_days: notice, share_percent: share, blackout_periods: periods.map((p) => ({ start_date: p.from, end_date: p.to, label_en: p.label })) });
            }}
          >
            {t('common.save')}
          </Button>
        </ReasonHint>
      </div>
      <ActionError error={save.error} onDismiss={save.reset} />
      <PeriodDialog open={periodOpen} onAdd={(period) => setPeriods([...periods, period])} />
    </div>
  );
}

function PeriodDialog({ open, onAdd }: { open: boolean; onAdd: (period: Blackout) => void }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const url = useUrlState();
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLabel('');
    setFrom('');
    setTo('');
    if (!open) setDismissed(false);
  }
  const close = () => {
    setDismissed(true);
    url.update({ blackout: null }, { history: 'replace', keepPage: true });
  };
  const need = label.trim() === '' ? m('need.label') : !DATE.test(from) || !DATE.test(to) ? m('need.dates') : to < from ? m('need.order') : null;
  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m('l.addPeriod')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={need} visible={false}>
            <Button
              variant="primary"
              onClick={() => {
                if (need !== null) return;
                onAdd({ label: label.trim(), from, to });
                close();
              }}
            >
              {m('l.addPeriod')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <Field label={m('b.label')} required>
          <Input value={label} maxLength={120} autoComplete="off" translate="no" data-autofocus="" onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <div className={styles.pair}>
          <Field label={m('h.from')} required>
            <DateInput value={from} showHijri onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={m('h.to')} required>
            <DateInput value={to} showHijri min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
      </Stack>
    </Modal>
  );
}
