'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Checkbox, DateInput, Drawer, Field, Input, SegmentedControl, Select, SkeletonText, StatusPill, Textarea, type Tone } from '@opendispatch/ui';
import { Check, Lock, Sparkles, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { AnswerMeta } from '@/components/opendispatch/assistant/AnswerMeta';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { readNotice, saveNotice } from './actions';
import styles from './LeavePolicyCalendar.module.css';
import { IMPACTS, NOTICE_TYPES, type Impact, type NoticeDraft, type NoticeRead, type NoticeType, type NoticeZone } from './types';

// Event notice drawer: drafts only

const MAX_CHARS = 4000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const IMPACT_TONE: Readonly<Record<Impact, Tone>> = { low: 'neutral', medium: 'warning', high: 'danger' };

export interface NoticeDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly zones: readonly NoticeZone[];
  /** Why reading is unavailable, or null. */
  readonly reason: string | null;
}

interface Keyed {
  readonly key: number;
  readonly draft: NoticeDraft;
}

export function NoticeDrawer({ open, onClose, zones, reason }: NoticeDrawerProps) {
  const m = useTranslations('admin.leave_policy_calendar');
  const locale = useLocale();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<NoticeRead | null>(null);
  const [drafts, setDrafts] = useState<readonly Keyed[]>([]);
  const read = useAdminAction(readNotice, {
    quiet: true,
    onSuccess: (out) => {
      setResult(out);
      setDrafts(out.drafts.map((draft, key) => ({ key, draft })));
    },
  });
  const blocked = reason ?? (text.trim() === '' ? m('nt.needText') : null);
  const run = () => {
    if (blocked !== null) return;
    setResult(null);
    read.run({ text: text.trim(), locale });
  };
  const drop = (key: number) => setDrafts((list) => list.filter((d) => d.key !== key));

  return (
    <Drawer open={open} onClose={onClose} title={m('nt.title')} width={560} footer={<span className={styles.meta}>{m('nt.foot')}</span>}>
      <div className={styles.stack} data-assistant="event-notice">
        <Field label={m('nt.label')} htmlFor={fieldId} hint={`${String(text.length)} / ${String(MAX_CHARS)}`}>
          <Textarea id={fieldId} rows={5} maxLength={MAX_CHARS} value={text} data-autofocus onChange={(event) => setText(event.target.value)} />
        </Field>
        <div className={styles.endRow}>
          {reason === null ? null : <Reason icon={<Lock />}>{reason}</Reason>}
          <ReasonHint reason={blocked} visible={false}>
            <Button variant="secondary" startIcon={<Sparkles />} loading={read.pending} onClick={run}>
              {m('nt.read')}
            </Button>
          </ReasonHint>
        </div>
        {read.pending ? <div aria-busy="true"><SkeletonText lines={3} announce /></div> : null}
        <ActionError error={read.error} onDismiss={read.reset} />
        {result === null || read.pending ? null : (
          <div className={styles.stack} aria-live="polite">
            <div className={styles.metaRow}>
              <AnswerMeta provider={result.provider} model={result.model} durationMs={result.duration_ms} illustrative={false} />
              <span className={styles.meta}>{result.drafts.length === 0 ? m('nt.none') : m('nt.found', { n: result.drafts.length })}</span>
            </div>
            {drafts.map(({ key, draft }) => (
              <DraftCard key={key} draft={draft} zones={zones} onDone={() => drop(key)} />
            ))}
            {result.unmapped.length === 0 ? null : (
              <Alert tone="warning" title={m('nt.unmapped')}>
                <ul className={styles.list}>
                  {result.unmapped.map((phrase, index) => (
                    <li key={index}>
                      <bdi>{phrase}</bdi>
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function needOf(m: ReturnType<typeof useTranslations>, name: string, from: string, to: string, fromTime: string, toTime: string): string | null {
  if (name.trim() === '') return m('need.name');
  if (!DATE.test(from) || !DATE.test(to)) return m('need.dates');
  if (to < from) return m('ev.err.order');
  if ((fromTime !== '' && !TIME.test(fromTime)) || (toTime !== '' && !TIME.test(toTime))) return m('nt.err.time');
  return null;
}

function DraftCard({ draft, zones, onDone }: { draft: NoticeDraft; zones: readonly NoticeZone[]; onDone: () => void }) {
  const m = useTranslations('admin.leave_policy_calendar');
  const [name, setName] = useState(draft.nameEn);
  const [type, setType] = useState<NoticeType>(draft.noticeType);
  const [from, setFrom] = useState(draft.startDate);
  const [to, setTo] = useState(draft.endDate);
  const [fromTime, setFromTime] = useState(draft.startTime ?? '');
  const [toTime, setToTime] = useState(draft.endTime ?? '');
  const [zoneIds, setZoneIds] = useState<readonly string[]>(draft.zoneIds);
  const [impact, setImpact] = useState<Impact>(draft.impact);
  const cityZones = draft.city === null ? [] : zones.filter((z) => z.city === draft.city);
  const save = useAdminAction(saveNotice, { successTitle: (saved) => m('toast.created', { name: saved.name }), onSuccess: onDone });
  const noZone = draft.city !== null && zoneIds.length === 0 ? m('nt.err.zones') : null;
  const need = needOf(m, name, from, to, fromTime, toTime) ?? noZone;
  const toggle = (id: string, on: boolean) => setZoneIds((list) => (on ? [...new Set([...list, id])] : list.filter((z) => z !== id)));
  const submit = () =>
    need === null &&
    save.run({
      name: name.trim(),
      name_ar: draft.nameAr ?? '',
      notice_type: type,
      zone_ids: zoneIds,
      start_date: from,
      end_date: to,
      start_time: fromTime,
      end_time: toTime,
      impact,
      impact_reason: draft.impactReason,
      quote: draft.quote,
    });

  return (
    <section className={styles.draft} aria-label={name}>
      <div className={styles.metaRow}>
        <StatusPill status={m('nt.draft')} tone="neutral" size="sm" />
        <StatusPill status={m(`nt.impact.${impact}`)} tone={IMPACT_TONE[impact]} size="sm" />
        {draft.fromHijri ? <StatusPill status={m('nt.fromHijri')} tone="info" size="sm" /> : null}
      </div>
      <div className={styles.pair}>
        <Field label={m('h.nameEn')} required>
          <Input value={name} translate="no" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={m('nt.type')}>
          <Select value={type} options={NOTICE_TYPES.map((k) => ({ value: k, label: m(`nt.types.${k}`) }))} onChange={(event) => setType(event.target.value as NoticeType)} />
        </Field>
      </div>
      <div className={styles.pair}>
        <Field label={m('h.from')} required>
          <DateInput value={from} showHijri onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={m('nt.fromTime')}>
          <Input value={fromTime} dir="ltr" inputMode="numeric" placeholder="HH:MM" onChange={(event) => setFromTime(event.target.value)} />
        </Field>
      </div>
      <div className={styles.pair}>
        <Field label={m('h.to')} required>
          <DateInput value={to} showHijri min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Field label={m('nt.toTime')}>
          <Input value={toTime} dir="ltr" inputMode="numeric" placeholder="HH:MM" onChange={(event) => setToTime(event.target.value)} />
        </Field>
      </div>
      <Field label={m('nt.zones')} labelAction={<span className={styles.meta} translate="no">{draft.city ?? m('ev.scope.all')}</span>}>
        {draft.city === null ? (
          <span className={styles.meta}>{m('nt.everywhere')}</span>
        ) : (
          <div className={styles.zoneRow}>
            {cityZones.map((z) => (
              <Checkbox key={z.id} label={<span translate="no">{z.code}</span>} checked={zoneIds.includes(z.id)} onChange={(event) => toggle(z.id, event.target.checked)} />
            ))}
          </div>
        )}
      </Field>
      <Field label={m('nt.expected')}>
        <SegmentedControl size="sm" value={impact} options={IMPACTS.map((k) => ({ value: k, label: m(`nt.lvl.${k}`) }))} onChange={(v) => setImpact(v as Impact)} />
      </Field>
      <blockquote className={styles.quote}>
        <bdi>{draft.quote}</bdi>
      </blockquote>
      <ActionError error={save.error} onDismiss={save.reset} />
      <div className={styles.endRow}>
        {need === null ? null : <Reason>{need}</Reason>}
        <Button variant="ghost" size="sm" startIcon={<Trash2 />} onClick={onDone}>
          {m('nt.discard')}
        </Button>
        <ReasonHint reason={need} visible={false}>
          <Button variant="primary" size="sm" startIcon={<Check />} loading={save.pending} onClick={submit}>
            {m('nt.save')}
          </Button>
        </ReasonHint>
      </div>
    </section>
  );
}
