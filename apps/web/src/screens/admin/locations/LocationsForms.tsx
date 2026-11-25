'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Field, FileDrop, Input, Menu, Modal, Select, Stack, Switch, Tag, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Info, Plus, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { StageChip } from '@/components/opendispatch/StageChip';
import { saveCsv } from '@/lib/export/download';
import { deleteStandby, importLocationsCsv, saveLocation } from './actions';
import { LOCATION_KINDS, type CityRow, type EditTarget, type LocationKind, type LocationRecord, type SubZoneOption, type ZoneOption } from './types';
import styles from './Locations.module.css';

// The forms of the Locations screen: the header's Add location and More, the one drawer that edits or
// adds a city, zone, sub-zone or standby point, and the import dialog. Every write is a server action through useAdminAction;
// the data layer authorises, validates and audits, and a role without `edit` sees the same controls disabled with the reason
//. Nothing here names the caller.

/** A CSV file the import dialog accepts is read in the browser and sent as text: at most this many bytes (the hint says 5 MB). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Where a saved record shows: the tab of its kind. */
const tabFor = (kind: LocationKind): string | null => (kind === 'sub_zone' ? 'subs' : kind === 'standby' ? 'standby' : null);

// ---------------------------------------------------------------------------------------------
// The header: Add location, and the More menu (Import, Export)
// ---------------------------------------------------------------------------------------------

export interface LocationsHeaderProps {
  readonly canEdit: boolean;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** Every record as CSV cells; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

export function AddLocationButton({ canEdit, variant = 'primary' }: { canEdit: boolean; variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('admin.locations');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ edit: 'zone:new', ar: null }, { history: 'push', keepPage: true })}>
        {m('add.label')}
      </Button>
    </ReasonHint>
  );
}

/** The import button of a card header or a filter bar: opens the dialog through `?import=1`. */
export function ImportButton({ canEdit, variant = 'secondary' }: { canEdit: boolean; variant?: 'secondary' | 'primary' }) {
  const m = useTranslations('admin.locations');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} size={variant === 'primary' ? 'md' : 'sm'} startIcon={<Upload />} onClick={() => gate.edit.allowed && url.update({ import: '1' }, { history: 'push', keepPage: true })}>
        {m('import.label')}
      </Button>
    </ReasonHint>
  );
}

/** The two header actions: Add location (primary) and More (Import and Export). */
export function LocationsHeader({ canEdit, exportFilename, exportHeader, exportRows }: LocationsHeaderProps) {
  const m = useTranslations('admin.locations');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const items: MenuEntry[] = [
    ...(gate.edit.reason === null ? [] : [{ type: 'heading', label: gate.edit.reason } as const]),
    { label: m('import.label'), icon: <Upload />, disabled: !gate.edit.allowed, onSelect: () => url.update({ import: '1' }, { history: 'push', keepPage: true }) },
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
      <AddLocationButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The edit and add drawer
// ---------------------------------------------------------------------------------------------

interface FormState {
  readonly kind: LocationKind;
  readonly name: string;
  readonly nameAr: string;
  readonly code: string;
  readonly parentId: string;
  readonly subZoneId: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly radius: string;
  readonly active: boolean;
}

const numberText = (value: number | null): string => (value === null ? '' : String(value));

function initialState(target: EditTarget | undefined, record: LocationRecord | undefined, cities: readonly CityRow[], zones: readonly ZoneOption[]): FormState {
  if (record !== undefined) {
    return {
      kind: record.kind,
      name: record.name,
      nameAr: record.nameAr ?? '',
      code: record.code,
      parentId: record.parentId ?? '',
      subZoneId: record.subZoneId ?? '',
      latitude: numberText(record.latitude),
      longitude: numberText(record.longitude),
      radius: numberText(record.radius),
      active: record.active,
    };
  }
  const kind = target?.kind ?? 'zone';
  return { kind, name: '', nameAr: '', code: '', parentId: firstParent(kind, cities, zones), subZoneId: '', latitude: '', longitude: '', radius: '', active: true };
}

const firstParent = (kind: LocationKind, cities: readonly CityRow[], zones: readonly ZoneOption[]): string => (kind === 'zone' ? (cities[0]?.id ?? '') : kind === 'city' ? '' : (zones[0]?.id ?? ''));

/** The number in a field, or null when it is empty, or NaN when it is not a number. */
function parsed(text: string): number | null {
  if (text.trim() === '') return null;
  return /^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

type Need = 'need.name' | 'need.parent' | 'need.geo' | 'need.radius' | null;

/** What is missing before Save, in the order the form asks: the same checks the data layer makes, so the person is told first. */
function needOf(form: FormState): Need {
  if (form.name.trim() === '' || form.code.trim() === '') return 'need.name';
  if (form.kind !== 'city' && form.parentId === '') return 'need.parent';
  const lat = parsed(form.latitude);
  const lon = parsed(form.longitude);
  const inRange = (value: number | null, limit: number): boolean => value !== null && Number.isFinite(value) && Math.abs(value) <= limit;
  if (form.kind === 'sub_zone' || form.kind === 'standby') {
    if (!inRange(lat, 90) || !inRange(lon, 180)) return 'need.geo';
  } else if (form.kind === 'zone') {
    if ((lat === null) !== (lon === null) || (lat !== null && !inRange(lat, 90)) || (lon !== null && !inRange(lon, 180))) return 'need.geo';
  }
  const radius = parsed(form.radius);
  if (form.kind === 'standby' && (radius === null || !Number.isInteger(radius) || radius < 100 || radius > 50000)) return 'need.radius';
  if (form.kind === 'zone' && radius !== null && !(radius > 0 && radius <= 100)) return 'need.radius';
  return null;
}

export interface LocationDrawerProps {
  /** `?edit=`, split; undefined when the address has none. */
  readonly target: EditTarget | undefined;
  /** The record `?edit=` opens; undefined for `new` and for an id that does not exist. */
  readonly record: LocationRecord | undefined;
  readonly canEdit: boolean;
  readonly cities: readonly CityRow[];
  readonly zones: readonly ZoneOption[];
  readonly subZones: readonly SubZoneOption[];
  /** `?ar=1`: the drawer opens with the Arabic field focused ("Add Arabic name"). */
  readonly focusArabic: boolean;
}

export function LocationDrawer({ target, record, canEdit, cities, zones, subZones, focusArabic }: LocationDrawerProps) {
  const m = useTranslations('admin.locations');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const isNew = target !== undefined && target.id === 'new';
  const open = record !== undefined || (isNew && canEdit);
  const recordKey = open && target !== undefined ? `${target.kind}:${target.id}` : '';
  const [seen, setSeen] = useState(recordKey);
  const [form, setForm] = useState<FormState>(() => initialState(target, record, cities, zones));
  const [confirming, setConfirming] = useState(false);
  if (recordKey !== seen) {
    setSeen(recordKey);
    setForm(initialState(target, record, cities, zones));
    setConfirming(false);
  }

  const save = useAdminAction(saveLocation, {
    successTitle: (result) => m(result.created ? 'toast.added' : 'toast.saved'),
    successDescription: (result) => result.name,
    onSuccess: (result) => url.update({ edit: null, ar: null, tab: tabFor(result.kind) }, { history: 'replace' }),
  });
  const remove = useAdminAction(deleteStandby, {
    successTitle: m('toast.deleted'),
    successDescription: (result) => result.name,
    onSuccess: () => {
      setConfirming(false);
      url.update({ edit: null, ar: null }, { history: 'replace', keepPage: true });
    },
  });

  if (!open || target === undefined) return <RecordDrawer open={false} param="edit" title="" />;

  const kind = form.kind;
  const need = needOf(form);
  const needText = need === null ? null : m(need);
  const change = (patch: Partial<FormState>) => {
    save.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const subOptions = subZones.filter((sub) => sub.zoneId === form.parentId);
  const geo = kind === 'zone' || kind === 'sub_zone' || kind === 'standby';

  function submit() {
    if (!gate.edit.allowed || needOf(form) !== null) return;
    const lat = parsed(form.latitude);
    const lon = parsed(form.longitude);
    const radius = parsed(form.radius);
    save.run({
      kind,
      ...(record === undefined ? {} : { targetId: record.id }),
      name_en: form.name.trim(),
      name_ar: form.nameAr.trim(),
      code: form.code.trim(),
      parent_id: kind === 'city' ? '' : form.parentId,
      sub_zone_id: kind === 'standby' ? form.subZoneId : '',
      latitude: kind === 'city' || lat === null || Number.isNaN(lat) ? null : lat,
      longitude: kind === 'city' || lon === null || Number.isNaN(lon) ? null : lon,
      radius: kind === 'zone' || kind === 'standby' ? (radius === null || Number.isNaN(radius) ? null : radius) : null,
      is_active: form.active,
    });
  }

  const title = m(record === undefined ? 'add.title' : 'edit.title', { kind: m(`kind.${record?.kind ?? kind}`) });
  const footer = (
    <div className={styles.footer}>
      {record?.kind === 'standby' ? (
        <ReasonHint reason={gate.edit.reason} visible={false}>
          <Button variant="secondary" startIcon={<Trash2 />} onClick={() => gate.edit.allowed && setConfirming(true)}>
            {m('delete.label')}
          </Button>
        </ReasonHint>
      ) : null}
      {needText === null ? null : <Reason icon={<Info />}>{needText}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ edit: null, ar: null }, { history: 'replace', keepPage: true })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate.edit.reason ?? needText} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={submit}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  const readOnly = !gate.edit.allowed;
  return (
    <>
      <RecordDrawer open param="edit" closeAlso={['ar']} recordKey={recordKey} title={title} subtitle={record === undefined ? undefined : <span translate="no">{record.code}</span>} footer={footer}>
        <Stack gap={16}>
          {record === undefined ? (
            <Field label={m('e.type')}>
              <Select
                value={kind}
                disabled={readOnly}
                options={LOCATION_KINDS.map((option) => ({ value: option, label: m(`kindn.${option}`) }))}
                onChange={(event) => {
                  const next = event.target.value as LocationKind;
                  change({ kind: next, parentId: firstParent(next, cities, zones), subZoneId: '' });
                }}
              />
            </Field>
          ) : null}
          {kind === 'city' ? null : (
            <Field label={kind === 'zone' ? m('e.parent.city') : t('common.zone')}>
              <Select
                value={form.parentId}
                disabled={readOnly}
                options={
                  kind === 'zone'
                    ? cities.map((city) => ({ value: city.id, label: city.name }))
                    : zones.map((zone) => ({ value: zone.id, label: `${zone.code} · ${zone.name}` }))
                }
                onChange={(event) => change({ parentId: event.target.value, subZoneId: '' })}
                translate="no"
              />
            </Field>
          )}
          {kind === 'standby' ? (
            <Field label={m('col.sub')}>
              <Select
                value={form.subZoneId}
                disabled={readOnly}
                placeholder={t('common.none')}
                options={subOptions.map((sub) => ({ value: sub.id, label: sub.name }))}
                onChange={(event) => change({ subZoneId: event.target.value })}
                translate="no"
              />
            </Field>
          ) : null}
          <Field label={m('e.name')} required>
            <Input value={form.name} disabled={readOnly} autoComplete="off" translate="no" onChange={(event) => change({ name: event.target.value })} />
          </Field>
          <Field label={m('col.ar')} hint={m('e.ar.hint')}>
            <Input value={form.nameAr} disabled={readOnly} autoComplete="off" lang="ar" dir="rtl" data-autofocus={focusArabic ? '' : undefined} onChange={(event) => change({ nameAr: event.target.value })} />
          </Field>
          <Field label={m('col.code')} required>
            <Input value={form.code} disabled={readOnly} readOnly={record !== undefined} autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ code: event.target.value })} />
          </Field>
          {geo ? (
            <div className={styles.geo}>
              <Field label={m('e.lat')} required={kind !== 'zone'}>
                <Input type="number" step="0.000001" value={form.latitude} disabled={readOnly} translate="no" dir="ltr" onChange={(event) => change({ latitude: event.target.value })} />
              </Field>
              <Field label={m('e.lon')} required={kind !== 'zone'}>
                <Input type="number" step="0.000001" value={form.longitude} disabled={readOnly} translate="no" dir="ltr" onChange={(event) => change({ longitude: event.target.value })} />
              </Field>
              {kind === 'sub_zone' ? null : (
                <Field label={kind === 'standby' ? m('e.radius.m') : m('e.radius.km')} required={kind === 'standby'}>
                  <Input type="number" step={kind === 'standby' ? '100' : '0.5'} value={form.radius} disabled={readOnly} translate="no" dir="ltr" onChange={(event) => change({ radius: event.target.value })} />
                </Field>
              )}
            </div>
          ) : null}
          {record?.kind === 'zone' && record.stage !== null ? (
            <div className={styles.stageRow}>
              <span className={styles.muted}>{m('shared.stage.label')}</span>
              <StageChip zone={record.code} stage={record.stage} />
            </div>
          ) : null}
          <Switch checked={form.active} disabled={readOnly} label={m('status.active')} onCheckedChange={(active) => change({ active })} />
          <ActionError error={save.error} onDismiss={save.reset} />
        </Stack>
      </RecordDrawer>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          remove.reset();
        }}
        onConfirm={() => record !== undefined && remove.run({ targetId: record.id })}
        title={m('delete.title', { name: record?.name ?? '' })}
        description={m('delete.desc')}
        confirmLabel={m('delete.ok')}
        tone="danger"
        pending={remove.pending}
        error={<ActionError error={remove.error} onDismiss={remove.reset} />}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The import dialog
// ---------------------------------------------------------------------------------------------

export interface ImportDialogProps {
  /** `?import=1` and the person may edit. Decided on the server. */
  readonly open: boolean;
  readonly canEdit: boolean;
  /** The sample file ("Use a sample file"), read on the server only while the dialog is open. */
  readonly sample: { readonly fileName: string; readonly text: string } | undefined;
}

interface Chosen {
  readonly name: string;
  readonly text: string;
  /** From "Use a sample file": the drop area holds no file then, so the dialog names it itself. */
  readonly sample: boolean;
}

export function ImportDialog({ open, canEdit, sample }: ImportDialogProps) {
  const m = useTranslations('admin.locations');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  /** Remounts the drop area: it keeps its own list of files, which "Use a sample file" must clear. */
  const [round, setRound] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setChosen(null);
    setReadFailed(false);
    setRound((n) => n + 1);
    if (!open) setDismissed(false);
  }

  const run = useAdminAction(importLocationsCsv, {
    successTitle: (result) => m('toast.imported', { n: result.total }),
    successDescription: (result) => m('toast.importedDesc', { cities: result.cities, zones: result.zones, subs: result.subZones, points: result.standbyPoints }),
    onSuccess: close,
  });

  function close() {
    setDismissed(true);
    run.reset();
    url.update({ import: null }, { history: 'replace', keepPage: true });
  }

  async function onFiles(files: File[]) {
    run.reset();
    setReadFailed(false);
    const file = files[0];
    if (file === undefined) {
      setChosen(null);
      return;
    }
    try {
      setChosen({ name: file.name, text: await file.text(), sample: false });
    } catch {
      setChosen(null);
      setReadFailed(true);
    }
  }

  const need = chosen === null ? m('need.file') : null;
  const reason = gate.edit.reason ?? need;
  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m('import.title')}
      description={m('import.desc')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={reason} visible={false}>
            <Button
              variant="primary"
              loading={run.pending}
              onClick={() => {
                if (reason === null && chosen !== null) run.run({ file: chosen.text });
              }}
            >
              {m('import.label')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <FileDrop key={round} accept=".csv" maxSize={MAX_FILE_BYTES} hint={m('import.hint')} onFiles={(files) => void onFiles(files)} />
        {chosen?.sample === true ? (
          <div className={styles.chosen}>
            <Tag color="gray">
              <span translate="no">{chosen.name}</span>
            </Tag>
          </div>
        ) : null}
        {readFailed ? <Alert tone="danger">{m('import.readFailed')}</Alert> : null}
        {sample === undefined ? null : (
          <div>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                run.reset();
                setReadFailed(false);
                setRound((n) => n + 1);
                setChosen({ name: sample.fileName, text: sample.text, sample: true });
              }}
            >
              {m('import.sample')}
            </Button>
          </div>
        )}
        <ActionError error={run.error} onDismiss={run.reset} />
      </Stack>
    </Modal>
  );
}
