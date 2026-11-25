'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, CardHeader, DateInput, Field, IconButton, Input, Modal, Select, Stack, StatusPill, useFormat, useToast } from '@opendispatch/ui';
import { Info, Lock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { removeRange, saveRange, setPayday } from './actions';
import { IMPACT_TONE, NoticeDrawer } from './NoticeDrawer';
import styles from './LeavePolicyCalendar.module.css';
import { RANGE_KINDS, type EventRow, type EventsView, type NoticeAssist, type RangeKind } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = /^\d{1,2}$/;

// Keys of the derived names OpenDispatch gives.
const DERIVED_KEY: Readonly<Record<string, string>> = { 'Eid al-Fitr': 'eid_fitr', 'Eid al-Adha': 'eid_adha', Hajj: 'hajj', 'National Day': 'national_day', 'Founding Day': 'founding_day' };

type Translate = ReturnType<typeof useTranslations>;

export interface EventsPanelProps {
  readonly view: EventsView;
  readonly canEdit: boolean;
  /** `?ev=`: a range id, or `new`. */
  readonly openId: string | undefined;
  readonly openKind: RangeKind | undefined;
  readonly payOpen: boolean;
  /** Null: the notice reader is hidden. */
  readonly assist: NoticeAssist | null;
}

/** The Events tab: what the forecaster's calendar holds. */
export function EventsPanel({ view, canEdit, openId, openKind, payOpen, assist }: EventsPanelProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const noticeReason = assist === null ? null : !assist.allowed || !canEdit ? t('opendispatch.gate.viewOnly') : assist.configured ? null : t('opendispatch.assistant.off');
  const format = useFormat();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const range = (row: { start: string; end: string }, calendar?: 'hijri') => (row.start === row.end ? format.date(row.start, calendar === undefined ? {} : { calendar }) : `${format.date(row.start, calendar === undefined ? {} : { calendar })} - ${format.date(row.end, calendar === undefined ? {} : { calendar })}`);
  const openNew = (kind: RangeKind) => gate.edit.allowed && url.update({ ev: 'new', evkind: kind }, { history: 'push', keepPage: true });
  const all = RANGE_KINDS.flatMap((kind) => view.ranges[kind]);
  const editing = openId === undefined || openId === 'new' ? undefined : all.find((r) => r.id === openId);

  const columns: AdminTableColumn[] = [
    { key: 'feature', header: m('ev.col.feature') },
    { key: 'dates', header: m('ev.col.dates'), hideBelow: 'md' },
    { key: 'source', header: m('ev.col.source'), hideBelow: 'md' },
    { key: 'actions', header: m('ev.col.actions'), align: 'end' },
  ];
  const group = (id: string, label: string): AdminTableRow => ({ id, label, cells: { feature: <span className={styles.groupLabel}>{label}</span> } });
  const feature = (main: ReactNode, sub: ReactNode, dates: string) => (
    <span>
      <span className={styles.cellMain}>{main}</span>
      {sub === null ? null : <span className={styles.cellSub}>{sub}</span>}
      <span className={`${styles.cellSub} ${styles.smallOnly}`} translate="no">
        {dates}
      </span>
    </span>
  );
  const lock = (tip: string) => (
    <ReasonHint reason={tip} visible={false}>
      <IconButton icon={<Lock />} label={tip} size="sm" disabled />
    </ReasonHint>
  );
  const source = (row: EventRow) => (
    <Badge tone={row.source === 'hijri' || row.source === 'customer' ? 'info' : 'neutral'} size="sm">
      {m(`ev.src.${row.source}`)}
    </Badge>
  );

  const rows: AdminTableRow[] = [group('group-set', m('ev.group.set'))];
  const payText = view.paydayDay > 0 ? m('ev.payVal', { n: view.paydayDay }) : m('ev.nothing');
  rows.push({
    id: 'payday',
    label: m('ev.payday'),
    cells: {
      feature: (
        <span>
          <span className={styles.cellMain}>{m('ev.payday')}</span>
          {view.paydayDay > 0 ? <StatusPill status={m('ev.assume')} tone="warning" size="sm" /> : null}
          <span className={`${styles.cellSub} ${styles.smallOnly}`}>{payText}</span>
        </span>
      ),
      dates: view.paydayDay > 0 ? <span translate="no">{payText}</span> : <span className={styles.muted}>{payText}</span>,
      source: <Badge size="sm">{m('ev.src.setting')}</Badge>,
      actions: view.paydayDay > 0 ? <PaydayActions canEdit={canEdit} /> : <SetButton label={m('ev.setDay')} canEdit={canEdit} onClick={() => url.update({ pay: '1' }, { history: 'push', keepPage: true })} />,
    },
  });
  for (const kind of RANGE_KINDS) {
    const list = view.ranges[kind];
    if (list.length === 0) {
      rows.push({
        id: `none-${kind}`,
        label: m(`ev.kind.${kind}`),
        cells: {
          feature: feature(m(`ev.kind.${kind}`), null, m('ev.nothing')),
          dates: <span className={styles.muted}>{m('ev.nothing')}</span>,
          source: <Badge size="sm">{m('ev.src.setting')}</Badge>,
          actions: <SetButton label={m('ev.addShort')} canEdit={canEdit} onClick={() => openNew(kind)} />,
        },
      });
      continue;
    }
    for (const row of list) {
      rows.push({
        id: row.id,
        label: row.name,
        cells: {
          feature: feature(<span translate="no">{row.name}</span>, m(`ev.kind.${kind}`), range(row)),
          dates: <span translate="no">{range(row)}</span>,
          source: source(row),
          actions: <RangeActions row={row} canEdit={canEdit} />,
        },
      });
    }
  }
  rows.push(group('group-notice', m('ev.group.notice')));
  if (view.notices.length === 0) rows.push({ id: 'notice-none', label: m('ev.noticeNone'), cells: { feature: <span className={styles.muted}>{m('ev.noticeNone')}</span> } });
  for (const row of view.notices) {
    const n = row.notice;
    const sub = n === undefined ? null : (
      <>
        {m(`nt.types.${n.noticeType}`)}
        {n.zoneCodes.length === 0 ? null : <span translate="no">{` · ${n.zoneCodes.join(', ')}`}</span>}
      </>
    );
    rows.push({
      id: row.id,
      label: row.name,
      cells: {
        feature: feature(<span translate="no">{row.name}</span>, sub, range(row)),
        dates: (
          <span className={styles.metaRow}>
            <span translate="no">{range(row)}</span>
            {n === undefined ? null : <StatusPill status={m(`nt.impact.${n.impact}`)} tone={IMPACT_TONE[n.impact]} size="sm" />}
          </span>
        ),
        source: <Badge size="sm">{m('ev.src.notice')}</Badge>,
        actions: <RangeActions row={row} canEdit={canEdit} removeOnly />,
      },
    });
  }
  rows.push(group('group-derived', m('ev.group.derived')));
  for (const row of view.derived) {
    const key = DERIVED_KEY[row.name];
    rows.push({
      id: row.id,
      label: row.name,
      cells: {
        feature: feature(key === undefined ? <span translate="no">{row.name}</span> : m(`ev.derivedName.${key}`), m(`ev.src.${row.source}`), range(row)),
        dates: (
          <span translate="no">
            <span className={styles.cellMain}>{range(row)}</span>
            {row.source === 'hijri' ? <span className={styles.cellSub}>{range(row, 'hijri')}</span> : null}
          </span>
        ),
        source: source(row),
        actions: lock(m('ev.derivedTip')),
      },
    });
  }
  return (
    <>
      <Card padding="none">
        <CardHeader
          title={
            <span className={styles.titleRow}>
              {m('ev.title')}
              <IllustrativeLabel />
            </span>
          }
          actions={
            <span className={styles.metaRow}>
              {assist === null ? null : (
                <ReasonHint reason={canEdit && assist.allowed ? null : t('opendispatch.gate.viewOnly')} visible={false}>
                  <Button variant="ghost" size="sm" startIcon={<Sparkles />} onClick={() => canEdit && assist.allowed && setNoticeOpen(true)} data-assistant="notice-open">
                    {m('nt.open')}
                  </Button>
                </ReasonHint>
              )}
              <ReasonHint reason={gate.edit.reason} visible={false}>
                <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => openNew('school')}>
                  {m('ev.add')}
                </Button>
              </ReasonHint>
            </span>
          }
        />
        <AdminTable caption={m('ev.title')} columns={columns} rows={rows} rowParam={false} pageSize={0} />
      </Card>
      <RangeModal key={openId === undefined ? 'closed' : `${openId}-${openKind ?? ''}`} open={openId !== undefined && canEdit} row={editing} kind={editing === undefined ? (openKind ?? 'school') : (editing.kind as RangeKind)} canEdit={canEdit} ranges={view.ranges} />
      <PaydayModal key={payOpen ? 'pay' : 'closed'} open={payOpen && canEdit} day={view.paydayDay} canEdit={canEdit} />
      {assist === null ? null : <NoticeDrawer open={noticeOpen} onClose={() => setNoticeOpen(false)} zones={view.zones} reason={noticeReason} />}
    </>
  );
}

function SetButton({ label, canEdit, onClick }: { label: string; canEdit: boolean; onClick: () => void }) {
  const t = useTranslations();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <Button variant="ghost" size="sm" startIcon={<Plus />} onClick={() => canEdit && onClick()}>
        {label}
      </Button>
    </ReasonHint>
  );
}

function RangeActions({ row, canEdit, removeOnly = false }: { row: EventRow; canEdit: boolean; removeOnly?: boolean }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const url = useUrlState();
  const remove = useAdminAction(removeRange, { successTitle: (result) => m('ev.removed', { name: result.name === '' ? row.name : result.name }) });
  const reason = canEdit ? null : t('opendispatch.gate.viewOnly');
  return (
    <span className={styles.rowActions}>
      {removeOnly ? null : (
        <ReasonHint reason={reason} visible={false}>
          <IconButton icon={<Pencil />} label={m('ev.edit')} size="sm" onClick={() => canEdit && url.update({ ev: row.id }, { history: 'push', keepPage: true })} />
        </ReasonHint>
      )}
      <ReasonHint reason={reason} visible={false}>
        <IconButton icon={<Trash2 />} label={m('ev.remove')} size="sm" disabled={remove.pending} onClick={() => canEdit && remove.run({ targetId: row.id })} />
      </ReasonHint>
    </span>
  );
}

function PaydayActions({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const url = useUrlState();
  const off = useAdminAction(setPayday, { successTitle: m('ev.payRemoved') });
  const reason = canEdit ? null : t('opendispatch.gate.viewOnly');
  return (
    <span className={styles.rowActions}>
      <ReasonHint reason={reason} visible={false}>
        <IconButton icon={<Pencil />} label={m('ev.edit')} size="sm" onClick={() => canEdit && url.update({ pay: '1' }, { history: 'push', keepPage: true })} />
      </ReasonHint>
      <ReasonHint reason={reason} visible={false}>
        <IconButton icon={<Trash2 />} label={m('ev.remove')} size="sm" disabled={off.pending} onClick={() => canEdit && off.run({ payday_day: 0 })} />
      </ReasonHint>
    </span>
  );
}

function overlapOf(ranges: EventsView['ranges'], kind: RangeKind, from: string, to: string, except: string | undefined): EventRow | undefined {
  return ranges[kind].find((r) => r.id !== except && from <= r.end && to >= r.start);
}

function needOf(m: Translate, ranges: EventsView['ranges'], kind: RangeKind, name: string, from: string, to: string, except: string | undefined): string | null {
  if (name.trim() === '') return m('need.name');
  if (!DATE.test(from) || !DATE.test(to)) return m('need.dates');
  if (to < from) return m('ev.err.order');
  const clash = overlapOf(ranges, kind, from, to, except);
  return clash === undefined ? null : m('ev.err.overlap', { name: clash.name });
}

function RangeModal({ open, row, kind: firstKind, canEdit, ranges }: { open: boolean; row: EventRow | undefined; kind: RangeKind; canEdit: boolean; ranges: EventsView['ranges'] }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const url = useUrlState();
  const [kind, setKind] = useState<RangeKind>(firstKind);
  const [name, setName] = useState(row?.name ?? '');
  const [from, setFrom] = useState(row?.start ?? '');
  const [to, setTo] = useState(row?.end ?? '');
  const [dismissed, setDismissed] = useState(false);
  const close = () => {
    setDismissed(true);
    url.update({ ev: null, evkind: null }, { history: 'replace', keepPage: true });
  };
  const save = useAdminAction(saveRange, { successTitle: (result) => m(result.created ? 'toast.created' : 'toast.updated', { name: result.name }), onSuccess: close });
  const need = needOf(m, ranges, kind, name, from, to, row?.id);
  const reason = canEdit ? need : t('opendispatch.gate.viewOnly');
  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m(row === undefined ? 'ev.newTitle' : 'ev.editTitle')}
      footer={
        <div className={styles.footer}>
          {need === null ? null : <Reason icon={<Info />}>{need}</Reason>}
          <span className={styles.push} />
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={reason} visible={false}>
            <Button variant="primary" loading={save.pending} onClick={() => reason === null && save.run({ ...(row === undefined ? {} : { targetId: row.id }), kind, name: name.trim(), start_date: from, end_date: to })}>
              {t('common.save')}
            </Button>
          </ReasonHint>
        </div>
      }
    >
      <Stack gap={12}>
        <Field label={m('ev.col.feature')}>
          <Select value={kind} disabled={row !== undefined} options={RANGE_KINDS.map((k) => ({ value: k, label: m(`ev.kind.${k}`) }))} onChange={(event) => setKind(event.target.value as RangeKind)} />
        </Field>
        <Field label={m('ev.name')} required>
          <Input value={name} autoComplete="off" translate="no" onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className={styles.pair}>
          <Field label={m('h.from')} required>
            <DateInput value={from} showHijri onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={m('h.to')} required>
            <DateInput value={to} showHijri min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </Modal>
  );
}

function PaydayModal({ open, day, canEdit }: { open: boolean; day: number; canEdit: boolean }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const t = useTranslations();
  const url = useUrlState();
  const toast = useToast();
  const [text, setText] = useState(day > 0 ? String(day) : '');
  const [dismissed, setDismissed] = useState(false);
  const close = () => {
    setDismissed(true);
    url.update({ pay: null }, { history: 'replace', keepPage: true });
  };
  const save = useAdminAction(setPayday, {
    quiet: true,
    onSuccess: () => {
      toast({ title: m('ev.paySaved'), tone: 'success' });
      close();
    },
  });
  const valid = DAY.test(text.trim()) && Number(text) >= 1 && Number(text) <= 31;
  const reason = canEdit ? (valid ? null : m('ev.err.day')) : t('opendispatch.gate.viewOnly');
  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m('ev.payday')}
      footer={
        <div className={styles.footer}>
          <span className={styles.push} />
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={reason} visible={false}>
            <Button variant="primary" loading={save.pending} onClick={() => reason === null && save.run({ payday_day: Number(text) })}>
              {t('common.save')}
            </Button>
          </ReasonHint>
        </div>
      }
    >
      <Stack gap={16}>
        <Field label={m('ev.payDayLabel')} required error={text.trim() !== '' && !valid ? m('ev.err.day') : undefined}>
          <Input value={text} dir="ltr" inputMode="numeric" autoComplete="off" invalid={text.trim() !== '' && !valid} onChange={(event) => setText(event.target.value)} />
        </Field>
        <span>
          <StatusPill status={m('ev.assume')} tone="warning" size="sm" />
        </span>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </Modal>
  );
}
