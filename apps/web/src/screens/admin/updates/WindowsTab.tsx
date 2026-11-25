'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Avatar, Button, Card, Checkbox, DataTable, DateInput, Field, IconButton, Input, SegmentedControl, StatusPill, Stack, Switch, Tag, useToast, type Column } from '@opendispatch/ui';
import { Info, Pencil, Plus, Siren, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { firstHijriDate, HijriDateField, toGregorian, type HijriDateValue, type HijriMonthOption } from '@/components/opendispatch/HijriDateField';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { addBlackout, removeBlackout, saveRecurring, setSecondApprover } from './actions';
import { windowRule } from './OverviewTab';
import { isClock, WEEK } from './dates';
import { useEmergencyDialog } from './UpdatesHeader';
import { useWhen } from './UpdatesShared';
import type { BlackoutView, WindowsView } from './types';
import styles from './Updates.module.css';

// The Change windows tab: the recurring window and the next ones,
// the blackout periods (entered in Gregorian or in Hijri), the approvers, and the emergency override. The two drawers are
// URL-driven (`?window=edit`, `?blackout=new`). The data layer replaces the whole list of windows on a write: the actions read
// the stored list and change the one thing this screen asked for. THE UPDATE AGENT IS A STUB.

export interface WindowsTabProps {
  readonly windows: WindowsView;
  readonly canEdit: boolean;
  readonly windowOpen: boolean;
  readonly blackoutOpen: boolean;
}

export function WindowsTab({ windows, canEdit, windowOpen, blackoutOpen }: WindowsTabProps) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const toast = useToast();
  const url = useUrlState();
  const when = useWhen();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const openEmergency = useEmergencyDialog();
  const first = windows.recurring[0];
  const reason = gate.edit.reason;
  const second = useAdminAction(setSecondApprover, {
    quiet: true,
    onSuccess: (saved) => toast({ title: saved.second_approver_required ? m('toast.secondOn') : m('toast.secondOff'), tone: 'info' }),
  });
  const removal = useAdminAction(removeBlackout, { successTitle: m('toast.blackoutGone') });

  type Upcoming = WindowsView['upcoming'][number];
  const upcomingColumns: Column<Upcoming>[] = [
    { key: 'date', header: m('win.date'), cell: (row) => <span translate="no">{when.weekdayDate(row.start)}</span> },
    { key: 'time', header: m('win.time'), cell: (row) => <bdi dir="ltr" translate="no">{when.range(row.start.slice(11, 16), row.end.slice(11, 16))}</bdi> },
    {
      key: 'status',
      header: m('win.status'),
      cell: (row) =>
        row.open ? (
          <StatusPill status={m('win.open')} tone="success" size="sm" />
        ) : (
          <span className={styles.stackTight}>
            <StatusPill status={m('win.blocked')} tone="warning" size="sm" />
            {row.blackoutLabel === null ? null : <span className={styles.meta}><span translate="no">{row.blackoutLabel}</span></span>}
          </span>
        ),
    },
  ];

  const blackoutColumns: Column<BlackoutView>[] = [
    { key: 'label', header: m('bo.label'), cell: (row) => <span translate="no">{row.label}</span> },
    {
      key: 'dates',
      header: m('bo.dates'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <span className={styles.strong}>
            <bdi dir="ltr" translate="no">{range(row.startGregorian, row.endGregorian, (day) => when.format.date(day))}</bdi>
          </span>
          <span className={styles.meta}>
            <bdi dir="ltr" translate="no">{range(row.startGregorian, row.endGregorian, (day) => when.format.date(day, { calendar: 'hijri', month: 'long' }))}</bdi>
          </span>
        </span>
      ),
    },
    { key: 'entered', header: m('bo.entered'), hideBelow: 'md', cell: (row) => <Tag color="gray">{row.enteredAs === 'hijri' ? m('bo.hijri') : m('bo.gregorian')}</Tag> },
    {
      key: 'remove',
      header: <span className={styles.srOnly}>{m('actions')}</span>,
      align: 'end',
      cell: (row) => (
        <ReasonHint reason={reason} visible={false} quiet>
          <IconButton icon={<Trash2 />} label={m('bo.remove')} variant="ghost" size="sm" onClick={() => reason === null && removal.run({ blackout_id: row.id })} />
        </ReasonHint>
      ),
    },
  ];

  return (
    <div className={styles.grid2}>
      <div className={styles.col}>
        <Card padding="none">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>{m('win.title')}</h2>
            <ReasonHint reason={reason} visible={false}>
              <Button variant="secondary" size="sm" startIcon={<Pencil />} onClick={() => reason === null && url.update({ window: 'edit' }, { history: 'push' })}>
                {m('win.edit')}
              </Button>
            </ReasonHint>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.stackTight}>
              <div className={styles.inline}>
                <span className={styles.strong}>{first === undefined ? '-' : windowRule(first, when)}</span>
                <Tag color="gray">
                  <span translate="no">Asia/Riyadh</span>
                </Tag>
              </div>
              <div className={styles.tags}>
                {WEEK.map((day) => (
                  <Tag key={day} color={first?.days.includes(day) === true ? 'geekblue' : 'gray'}>
                    <span className={first?.days.includes(day) === true ? undefined : styles.dim}>{when.shortDay(day)}</span>
                  </Tag>
                ))}
              </div>
            </div>
          </div>
          <DataTable dense pageSize={0} caption={m('win.title')} columns={upcomingColumns} rows={[...windows.upcoming]} getRowId={(row) => row.start} rowTone={(row) => (row.open ? undefined : 'warning')} />
        </Card>

        <Card padding="none">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>{m('bo.title')}</h2>
            <ReasonHint reason={reason} visible={false}>
              <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => reason === null && url.update({ blackout: 'new' }, { history: 'push' })}>
                {m('bo.add')}
              </Button>
            </ReasonHint>
          </div>
          <DataTable dense pageSize={0} caption={m('bo.title')} columns={blackoutColumns} rows={[...windows.blackouts]} getRowId={(row) => row.id} emptyState={<p className={styles.empty}>{m('bo.none')}</p>} />
          <ActionError error={removal.error} onDismiss={removal.reset} />
        </Card>
      </div>

      <aside className={styles.col}>
        <Card padding="lg">
          <div className={styles.cardInner}>
            <div className={styles.head}>
              <h2 className={styles.cardTitle}>{m('ap.title')}</h2>
            </div>
            <div className={styles.stack}>
              {windows.approvers.length === 0 ? (
                <span className={styles.meta}>{m('ap.none')}</span>
              ) : (
                windows.approvers.map((person) => (
                  <div key={person.id} className={styles.inline}>
                    <Avatar name={person.name} size="sm" />
                    <span className={styles.stackTight}>
                      <span className={styles.strong} translate="no">
                        {person.name}
                      </span>
                      <span className={styles.meta}>{t('roles.change_approver')}</span>
                    </span>
                  </div>
                ))
              )}
              <Switch label={m('ap.secondRequired')} checked={windows.secondApproverRequired} disabled={reason !== null || second.pending} onCheckedChange={(next) => reason === null && second.run({ second_approver_required: next })} />
              {reason === null ? null : <Reason>{reason}</Reason>}
              <ActionError error={second.error} onDismiss={second.reset} />
            </div>
          </div>
        </Card>
        <Card padding="lg">
          <div className={styles.cardInner}>
            <div className={styles.head}>
              <h2 className={styles.cardTitle}>{m('menu.emergency')}</h2>
              <StatusPill status={windows.emergencyEnabled ? t('common.on') : t('common.off')} tone={windows.emergencyEnabled ? 'success' : 'neutral'} size="sm" />
            </div>
            <div className={styles.stack}>
              <span className={styles.meta}>{m('em.needs')}</span>
              <div>
                <ReasonHint reason={reason} visible={false}>
                  <Button variant="danger" size="sm" startIcon={<Siren />} onClick={() => reason === null && openEmergency()}>
                    {m('menu.emergency')}
                  </Button>
                </ReasonHint>
              </div>
              {reason === null ? null : <Reason>{reason}</Reason>}
            </div>
          </div>
        </Card>
      </aside>

      <WindowDrawer open={windowOpen} canEdit={canEdit} window={first === undefined ? { id: undefined, days: [0, 1, 2, 3, 4], start: '03:00', end: '05:00' } : { id: first.id, days: first.days, start: first.start, end: first.end }} />
      <BlackoutDrawer open={blackoutOpen} canEdit={canEdit} months={windows.months} />
    </div>
  );
}

/** "12 Sept 2026" or "12 Sept 2026 - 14 Sept 2026". */
function range(from: string, to: string, write: (day: string) => string): string {
  return from === to ? write(from) : `${write(from)} - ${write(to)}`;
}

// ---------------------------------------------------------------------------------------------
// The recurring window drawer
// ---------------------------------------------------------------------------------------------

function WindowDrawer({ open, canEdit, window: current }: { open: boolean; canEdit: boolean; window: { id: string | undefined; days: readonly number[]; start: string; end: string } }) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const when = useWhen();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [days, setDays] = useState<number[]>([...current.days]);
  const [start, setStart] = useState(current.start);
  const [end, setEnd] = useState(current.end);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDays([...current.days]);
      setStart(current.start);
      setEnd(current.end);
    }
  }
  const save = useAdminAction(saveRecurring, {
    successTitle: m('toast.windows'),
    onSuccess: () => url.update({ window: null }, { history: 'replace' }),
  });
  const need = days.length === 0 ? m('win.needDay') : !isClock(start) || !isClock(end) ? m('win.needTime') : null;
  const reason = gate.edit.reason ?? need;
  const footer = (
    <div className={styles.footer}>
      {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ window: null })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={reason} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={() => reason === null && save.run({ window_id: current.id, days_of_week: days, start_time: start, end_time: end })}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );
  return (
    <RecordDrawer open={open} param="window" title={m('win.title')} subtitle={m('nw.tzLine')} footer={footer}>
      <Stack gap={20}>
        <fieldset className={styles.plainFieldset}>
          <legend className={styles.legend}>{m('win.days')}</legend>
          <div className={styles.days}>
            {WEEK.map((day) => (
              <Checkbox key={day} label={when.shortDay(day)} checked={days.includes(day)} onChange={(event) => setDays((previous) => (event.target.checked ? [...previous, day].sort((a, b) => a - b) : previous.filter((d) => d !== day)))} />
            ))}
          </div>
        </fieldset>
        <div className={styles.formGrid}>
          <Field label={m('from')}>
            <Input type="time" value={start} dir="ltr" onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label={m('to')}>
            <Input type="time" value={end} dir="ltr" onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </div>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// The blackout drawer: Gregorian or Hijri entry
// ---------------------------------------------------------------------------------------------

function BlackoutDrawer({ open, canEdit, months }: { open: boolean; canEdit: boolean; months: readonly HijriMonthOption[] }) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const when = useWhen();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const startHijri = firstHijriDate(months);
  const [label, setLabel] = useState('');
  const [calendar, setCalendar] = useState<'gregorian' | 'hijri'>('gregorian');
  const [gFrom, setGFrom] = useState('');
  const [gTo, setGTo] = useState('');
  const [hFrom, setHFrom] = useState<HijriDateValue | null>(startHijri);
  const [hTo, setHTo] = useState<HijriDateValue | null>(startHijri);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLabel('');
      setCalendar('gregorian');
      setGFrom('');
      setGTo('');
      setHFrom(startHijri);
      setHTo(startHijri);
    }
  }
  const add = useAdminAction(addBlackout, {
    successTitle: m('toast.blackout'),
    onSuccess: () => url.update({ blackout: null }, { history: 'replace' }),
  });

  const gregorianFrom = calendar === 'hijri' ? (hFrom === null ? null : toGregorian(months, hFrom)) : gFrom === '' ? null : gFrom;
  const gregorianTo = calendar === 'hijri' ? (hTo === null ? null : toGregorian(months, hTo)) : gTo === '' ? null : gTo;
  const need = label.trim() === '' ? m('bo.needLabel') : gregorianFrom === null || gregorianTo === null ? m('bo.needDate') : gregorianTo < gregorianFrom ? m('bo.needOrder') : null;
  const reason = gate.edit.reason ?? need;
  const labels = { day: m('bo.day'), month: m('bo.month'), year: m('bo.year'), caption: (date: string) => m('bo.sameDay', { date }) };

  const footer = (
    <div className={styles.footer}>
      {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ blackout: null })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={reason} visible={false}>
        <Button
          variant="primary"
          loading={add.pending}
          onClick={() => {
            if (reason !== null) return;
            add.run(
              calendar === 'hijri' && hFrom !== null && hTo !== null
                ? { label: label.trim(), entered_as: 'hijri', start_hijri: hFrom, end_hijri: hTo }
                : { label: label.trim(), entered_as: 'gregorian', start_gregorian: gFrom, end_gregorian: gTo },
            );
          }}
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer open={open} param="blackout" title={m('bo.add')} footer={footer}>
      <Stack gap={20}>
        <Field label={m('bo.label')} required>
          <Input value={label} maxLength={120} autoComplete="off" translate="no" onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label={m('bo.enterAs')}>
          <SegmentedControl
            ariaLabel={m('bo.enterAs')}
            value={calendar}
            onChange={(next) => setCalendar(next === 'hijri' ? 'hijri' : 'gregorian')}
            options={[
              { value: 'gregorian', label: m('bo.gregorian') },
              { value: 'hijri', label: m('bo.hijri') },
            ]}
          />
        </Field>
        {calendar === 'gregorian' ? (
          <div className={styles.formGrid}>
            <Field label={m('from')}>
              <DateInput value={gFrom} dir="ltr" showHijri onChange={(event) => setGFrom(event.target.value)} />
            </Field>
            <Field label={m('to')}>
              <DateInput value={gTo} dir="ltr" showHijri onChange={(event) => setGTo(event.target.value)} />
            </Field>
          </div>
        ) : hFrom === null || hTo === null ? (
          <Reason icon={<Info />}>{m('bo.noReference')}</Reason>
        ) : (
          <Stack gap={16}>
            <HijriDateField legend={m('from')} months={months} value={hFrom} onChange={setHFrom} labels={labels} />
            <HijriDateField legend={m('to')} months={months} value={hTo} onChange={setHTo} labels={labels} />
          </Stack>
        )}
        {calendar === 'hijri' || gregorianFrom === null || gregorianTo === null ? null : (
          <span className={styles.meta}>
            {m('bo.preview')}:{' '}
            <bdi dir="ltr" translate="no">
              {range(gregorianFrom, gregorianTo, (day) => when.format.date(day, { calendar: 'hijri', month: 'long' }))}
            </bdi>
          </span>
        )}
        <ActionError error={add.error} onDismiss={add.reset} />
      </Stack>
    </RecordDrawer>
  );
}
