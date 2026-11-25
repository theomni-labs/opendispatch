'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, IconButton, DescriptionList, Field, FileDrop, FormGrid, FormSection, Input, Menu, Select, Stack, Textarea, Tooltip, useToast, Badge, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Globe, Info, Plus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint } from '@/components/opendispatch/ReasonHint';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { useRouter } from '@/i18n/navigation';
import { saveCsv } from '@/lib/export/download';
import { saveEvidence, saveSessionPolicy, setMfaClaim } from './actions';
import styles from './Security.module.css';
import { CONTROL_STATUSES, type ControlRow, type ControlStatus, type SessionView } from './types';

// The forms of the Security and Compliance screen: the header (Upload evidence, and More with Export
// controls report), the session policy form with the MFA switch, and the evidence drawer with its file drop. Every write is a server
// action through useAdminAction; the data layer authorises, validates and audits, and a role without `edit` sees the same controls
// disabled with the reason.

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_ACCEPT = '.pdf,.docx,.png';

export interface SecurityHeaderProps {
  readonly canEdit: boolean;
  /** The control the header's Upload evidence opens (the first one), or undefined while the page shows a review state. */
  readonly firstControlId: string | undefined;
  /** The controls report as text for Export, or undefined while the page shows a review state (nothing was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
  readonly exportHeader: readonly string[];
  readonly exportFilename: string;
}

export function UploadButton({ canEdit, firstControlId }: { canEdit: boolean; firstControlId: string | undefined }) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const url = useUrlState();
  const reason = !canEdit ? t('opendispatch.gate.viewOnly') : firstControlId === undefined ? m('states.empty.title') : null;
  return (
    <ReasonHint reason={reason} visible={false}>
      <Button
        variant="primary"
        startIcon={<Upload />}
        onClick={() => {
          if (reason === null && firstControlId !== undefined) url.update({ control: firstControlId }, { history: 'push' });
        }}
      >
        {m('upload')}
      </Button>
    </ReasonHint>
  );
}

/** The two header actions: Upload evidence (primary) and More (Export controls report). The State and Rejected file menus of the mockup are review tooling. */
export function SecurityHeader({ canEdit, firstControlId, exportRows, exportHeader, exportFilename }: SecurityHeaderProps) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const toast = useToast();
  const items: MenuEntry[] = [
    {
      label: m('export'),
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
      <UploadButton canEdit={canEdit} firstControlId={firstControlId} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

/** The icon button of a control's row: opens its evidence drawer (the row itself opens it too). */
export function UploadRowButton({ controlId, canEdit }: { controlId: string; canEdit: boolean }) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const url = useUrlState();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible={false}>
      <IconButton icon={<Upload />} label={m('upload')} variant="ghost" size="sm" onClick={() => canEdit && url.update({ control: controlId }, { history: 'push' })} />
    </ReasonHint>
  );
}

/** The empty state's action: the list is always present in demo mode (system.ts seeds it), so this refreshes it and says so. */
export function LoadControlsButton({ canEdit }: { canEdit: boolean }) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  return (
    <ReasonHint reason={canEdit ? null : t('opendispatch.gate.viewOnly')} visible>
      <Button
        variant="secondary"
        startIcon={<Plus />}
        onClick={() => {
          if (!canEdit) return;
          router.refresh();
          toast({ title: m('toast.loaded'), tone: 'info' });
        }}
      >
        {m('loadList')}
      </Button>
    </ReasonHint>
  );
}

/** The data residency badge of the header: a fixed text, not data. */
export function ResidencyBadge() {
  const m = useTranslations('admin.security_compliance');
  return (
    <Tooltip content={m('residency.tip')}>
      <span data-residency="" tabIndex={0}>
        <Badge tone="success" icon={<Globe />}>
          {m('residency.label')}
        </Badge>
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------------------------
// The session policy form
// ---------------------------------------------------------------------------------------------

export interface SessionFormProps {
  readonly session: SessionView;
  readonly mfaRequired: boolean;
  readonly canEdit: boolean;
  /** Why the MFA switch is off limits when the person may edit here but not the Sign-in policy it writes (a shared install). */
  readonly mfaReason: string | null;
}

const whole = (text: string): number | null => (/^\d{1,5}$/.test(text.trim()) ? Number(text) : null);

export function SessionForm({ session, mfaRequired, canEdit, mfaReason }: SessionFormProps) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const toast = useToast();
  const initial = { length: String(session.lengthMinutes), idle: String(session.idleMinutes), per: String(session.perPerson) };
  const [draft, setDraft] = useState(initial);
  // What the server holds now; the form starts again from it whenever that changes (after a save).
  const [held, setHeld] = useState(() => JSON.stringify(initial));
  if (JSON.stringify(initial) !== held) {
    setHeld(JSON.stringify(initial));
    setDraft(initial);
  }
  const length = whole(draft.length);
  const idle = whole(draft.idle);
  const per = whole(draft.per);
  const inRange = length !== null && length >= 5 && length <= 1440 && idle !== null && idle >= 1 && idle <= 240 && per !== null && per >= 1 && per <= 20;
  const idleTooLong = length !== null && idle !== null && idle > length;
  const dirty = draft.length !== initial.length || draft.idle !== initial.idle || draft.per !== initial.per;

  const save = useAdminAction(saveSessionPolicy, { successTitle: m('toast.policy') });
  const mfa = useAdminAction(setMfaClaim, {
    quiet: true,
    failureToast: true,
    onSuccess: (saved) => toast({ title: m(saved.required ? 'toast.mfaOn' : 'toast.mfaOff'), tone: saved.required ? 'success' : 'info' }),
  });

  const roReason = canEdit ? null : t('opendispatch.gate.viewOnly');
  const saveReason = roReason ?? (idleTooLong ? m('sess.err') : !inRange ? m('sess.range') : dirty ? null : m('need.changes'));

  return (
    <Stack gap={24}>
      <FormSection title={m('sess.title')}>
        <FormGrid columns={3}>
          <Field label={m('sess.length')}>
            <Input type="number" min={5} max={1440} step={1} suffix={t('common.minShort')} dir="ltr" value={draft.length} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, length: event.target.value })} />
          </Field>
          <Field label={m('sess.idle')} {...(idleTooLong ? { error: m('sess.err') } : {})}>
            <Input type="number" min={1} max={240} step={1} suffix={t('common.minShort')} dir="ltr" value={draft.idle} invalid={idleTooLong} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, idle: event.target.value })} />
          </Field>
          <Field label={m('sess.max')}>
            <Input type="number" min={1} max={20} step={1} dir="ltr" value={draft.per} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, per: event.target.value })} />
          </Field>
        </FormGrid>
      </FormSection>
      <FormSection title={m('mfa.title')}>
        <ReasonSwitch
          reason={roReason ?? mfaReason}
          checked={mfaRequired}
          label={m('mfa.label')}
          description={m('mfa.desc')}
          onCheckedChange={(next) => {
            if (roReason === null && mfaReason === null) mfa.run({ required: next });
          }}
        />
      </FormSection>
      <FormSection title={m('res.title')}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: m('res.where'),
              value: (
                <Badge tone="success" icon={<Globe />}>
                  {m('residency.label')}
                </Badge>
              ),
            },
            { label: m('res.leaves'), value: m('res.leavesValue') },
          ]}
        />
      </FormSection>
      <div className={styles.actionsRow}>
        <ReasonHint reason={saveReason} visible={false}>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={() => {
              if (saveReason === null && length !== null && idle !== null && per !== null) save.run({ session_length_minutes: length, idle_timeout_minutes: idle, max_concurrent_sessions: per });
            }}
          >
            {t('common.save')}
          </Button>
        </ReasonHint>
        <Button variant="ghost" onClick={() => setDraft(initial)} disabled={!dirty}>
          {m('reset')}
        </Button>
        {saveReason === null || roReason !== null ? null : (
          <Reason icon={<Info />}>{saveReason}</Reason>
        )}
      </div>
      <ActionError error={save.error ?? mfa.error} onDismiss={() => (save.error === null ? mfa.reset() : save.reset())} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// The evidence drawer
// ---------------------------------------------------------------------------------------------

export interface EvidenceOption {
  readonly id: string;
  /** The reference and the title as the screen shows them in the list of controls. */
  readonly label: string;
}

export interface EvidenceDrawerProps {
  /** The control `?control=` names; undefined: closed. The parent gives the component a `key` for it, so another control starts afresh. */
  readonly control: ControlRow | undefined;
  readonly options: readonly EvidenceOption[];
  readonly canEdit: boolean;
}

const STATUS_KEY: Readonly<Record<ControlStatus, string>> = { not_started: 'st.not_started', in_progress: 'st.in_progress', evidenced: 'st.evidenced', not_applicable: 'st.not_applicable' };

export function EvidenceDrawer({ control, options, canEdit }: EvidenceDrawerProps) {
  const m = useTranslations('admin.security_compliance');
  const t = useTranslations();
  const url = useUrlState();
  const [status, setStatus] = useState<ControlStatus>(control?.status ?? 'not_started');
  const [note, setNote] = useState(control?.note ?? '');
  const [files, setFiles] = useState<File[]>([]);

  const close = () => url.update({ control: null }, { history: 'replace' });
  const save = useAdminAction(saveEvidence, { successTitle: m('toast.evidence'), successDescription: (saved) => saved.ref, onSuccess: close });

  if (control === undefined) return <RecordDrawer open={false} param="control" title="" />;

  const roReason = canEdit ? null : t('opendispatch.gate.viewOnly');
  const tooLong = note.length > 1000;
  const gate = roReason ?? (tooLong ? m('need.noteLong') : null);

  const footer = (
    <div className={styles.footer}>
      {gate === null || roReason !== null ? null : <Reason icon={<Info />}>{gate}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={close}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={() => gate === null && save.run({ controlId: control.id, status, evidence_note: note.trim() })}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer open recordKey={control.id} param="control" title={m('upload')} subtitle={<span translate="no">{control.ref}</span>} footer={footer}>
      <Stack gap={20}>
        <Field label={m('col.control')}>
          <Select value={control.id} translate="no" options={options.map((option) => ({ value: option.id, label: option.label }))} onChange={(event) => url.update({ control: event.target.value }, { history: 'replace' })} />
        </Field>
        <Field label={t('common.status')}>
          <Select value={status} disabled={!canEdit} options={CONTROL_STATUSES.map((value) => ({ value, label: m(STATUS_KEY[value]) }))} onChange={(event) => setStatus(event.target.value as ControlStatus)} />
        </Field>
        <Field label={m('col.evidence')} {...(tooLong ? { error: m('need.noteLong') } : {})}>
          <Textarea value={note} rows={3} disabled={!canEdit} invalid={tooLong} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Stack gap={8}>
          <div className={styles.inline}>
            <span className={styles.label}>{m('drop.title')}</span>
            <StubTag kind="demo" />
          </div>
          <FileDrop accept={EVIDENCE_ACCEPT} maxSize={EVIDENCE_MAX_BYTES} multiple hint={m('drop.hint')} onFiles={setFiles} />
          {files.length === 0 ? null : <span className={styles.meta}>{m('drop.notStored')}</span>}
        </Stack>
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}
