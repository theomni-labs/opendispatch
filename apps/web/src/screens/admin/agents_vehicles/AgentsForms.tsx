'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Checkbox, DescriptionList, Field, FileDrop, Input, Menu, Modal, Select, Stack, StatusPill, Switch, Tag, useFormat, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, Download, Info, Plus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { addSkillToVocabulary, importAgentsCsv, saveAgent, saveVehicle } from './actions';
import { DAYS, VEHICLE_TYPES, type Day, type ShiftChoice, type SkillRow, type StandbyChoice, type AgentRow, type VehicleRow, type VehicleType, type ZoneChoice } from './types';
import type { MaintenanceByVehicle } from './maintenance-types';
import { MaintenanceSection } from './VehicleMaintenance';
import styles from './AgentsVehicles.module.css';

// The forms of the Agents and Vehicles screen: the header (Add for the tab, More: Import, Export),
// the agent and vehicle drawers, the skill dialog and the import dialog. Every write is a server action through useAdminAction;
// the data layer authorises, validates and audits, and a role without `edit` sees the same controls disabled with the reason
//. Nothing here names the caller.

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const STAFF_CODE = /^\S{1,32}$/;

// ---------------------------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------------------------

export function AddButton({ canEdit, tab, variant = 'primary' }: { canEdit: boolean; tab: 'agents' | 'vehicles' | 'skills'; variant?: 'primary' | 'secondary' }) {
  const m = useTranslations('admin.agents_vehicles');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const param = tab === 'vehicles' ? 'vehicle' : tab === 'skills' ? 'skill' : 'agent';
  return (
    <ReasonHint reason={gate.edit.reason} visible={false}>
      <Button variant={variant} startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ [param]: 'new' }, { history: 'push', keepPage: true })}>
        {m(tab === 'vehicles' ? 'add.vehicle' : tab === 'skills' ? 'add.skill' : 'add.agent')}
      </Button>
    </ReasonHint>
  );
}

export interface HeaderProps {
  readonly canEdit: boolean;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** The agents on screen as CSV cells; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

/** The two header actions: Add (for the tab in the address) and More (Import, Export). */
export function AgentsHeader({ canEdit, exportFilename, exportHeader, exportRows }: HeaderProps) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const tab = url.get('tab');
  const current = tab === 'vehicles' || tab === 'skills' ? tab : 'agents';
  const items: MenuEntry[] = [
    ...(gate.edit.reason === null ? [] : [{ type: 'heading', label: gate.edit.reason } as const]),
    { label: m('import'), icon: <Upload />, disabled: !gate.edit.allowed, onSelect: () => url.update({ import: '1' }, { history: 'push', keepPage: true }) },
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
      <AddButton canEdit={canEdit} tab={current} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The agent drawer
// ---------------------------------------------------------------------------------------------

interface AgentForm {
  readonly name: string;
  readonly code: string;
  readonly zoneId: string;
  readonly shift: string;
  readonly vehicleId: string;
  readonly standbyId: string;
  readonly daysOff: readonly Day[];
  readonly skills: readonly string[];
  readonly eligible: readonly string[];
  readonly annual: string;
  readonly active: boolean;
}

const ANNUAL_DAYS = /^\d{1,3}$/;

const toggle = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function agentForm(row: AgentRow | undefined, zones: readonly ZoneChoice[]): AgentForm {
  if (row === undefined) return { name: '', code: '', zoneId: zones[0]?.id ?? '', shift: '', vehicleId: '', standbyId: '', daysOff: [], skills: [], eligible: [], annual: '', active: true };
  return {
    name: row.name,
    code: row.code,
    zoneId: row.zoneId ?? '',
    shift: row.shiftCode ?? '',
    vehicleId: row.vehicleId ?? '',
    standbyId: row.standbyPointId ?? '',
    daysOff: row.daysOff,
    skills: row.skills,
    eligible: row.eligibleShiftIds,
    annual: row.annualLeaveDays === null ? '' : String(row.annualLeaveDays),
    active: row.active,
  };
}

export interface AgentDrawerProps {
  /** The agent `?agent=` opens; undefined for `new` and for an id that does not exist. */
  readonly agent: AgentRow | undefined;
  /** `?agent=new` and the person may edit. Decided on the server. */
  readonly isNew: boolean;
  readonly canEdit: boolean;
  readonly zones: readonly ZoneChoice[];
  readonly shifts: readonly ShiftChoice[];
  readonly vehicles: readonly VehicleRow[];
  readonly standby: readonly StandbyChoice[];
  readonly skills: readonly SkillRow[];
}

export function AgentDrawer({ agent, isNew, canEdit, zones, shifts, vehicles, standby, skills }: AgentDrawerProps) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const format = useFormat();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const open = agent !== undefined || isNew;
  const key = !open ? '' : agent === undefined ? 'new' : agent.id;
  const [seen, setSeen] = useState(key);
  const [form, setForm] = useState<AgentForm>(() => agentForm(agent, zones));
  if (key !== seen) {
    setSeen(key);
    setForm(agentForm(agent, zones));
  }
  const save = useAdminAction(saveAgent, {
    successTitle: (result) => m(result.created ? 'toast.added.s' : 'toast.saved.s'),
    successDescription: (result) => result.name,
    onSuccess: () => url.update({ agent: null }, { history: 'replace', keepPage: true }),
  });
  if (!open) return <RecordDrawer open={false} param="agent" title="" />;

  const change = (patch: Partial<AgentForm>) => {
    save.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const remote = form.zoneId === '';
  const annualOk = form.annual.trim() === '' || (ANNUAL_DAYS.test(form.annual.trim()) && Number(form.annual.trim()) <= 365);
  const need = form.name.trim() === '' ? m('need.name') : isNew && !STAFF_CODE.test(form.code.trim()) ? m('need.code') : !annualOk ? m('need.annual') : null;
  const readOnly = !gate.edit.allowed;
  const kind = remote ? 'remote' : 'field';
  const shiftChoices = shifts.filter((s) => s.kind === kind);
  const vehicleChoices = vehicles.filter((v) => v.zoneId === form.zoneId);
  const standbyChoices = standby.filter((p) => p.zoneId === form.zoneId);
  const ownVehicle = agent?.vehicleId === null || agent?.vehicleId === undefined ? undefined : vehicles.find((v) => v.id === agent.vehicleId);

  function submit() {
    if (!gate.edit.allowed || need !== null) return;
    save.run({
      ...(agent === undefined ? {} : { targetId: agent.id }),
      name_en: form.name.trim(),
      code: form.code.trim(),
      zone_id: form.zoneId,
      shift_code: form.shift,
      vehicle_id: remote ? '' : form.vehicleId,
      standby_point_id: remote ? '' : form.standbyId,
      days_off: form.daysOff,
      skill_codes: form.skills,
      eligible_shift_ids: form.eligible.filter((id) => shiftChoices.some((s) => s.id === id)),
      annual_leave_days: form.annual.trim(),
      is_active: form.active,
    });
  }

  const footer = (
    <div className={styles.footer}>
      {need === null || !gate.edit.allowed ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ agent: null }, { history: 'replace', keepPage: true })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate.edit.reason ?? need} visible={false}>
        <Button variant="primary" loading={save.pending} onClick={submit}>
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );

  return (
    <RecordDrawer open param="agent" recordKey={key} title={agent === undefined ? m('title.add.agent') : m('title.edit.agent')} subtitle={agent === undefined ? undefined : <span translate="no">{agent.code}</span>} footer={footer}>
      <Stack gap={16}>
        <Field label={m('col.name')} required>
          <Input value={form.name} disabled={readOnly} autoComplete="off" translate="no" onChange={(event) => change({ name: event.target.value })} />
        </Field>
        {isNew ? (
          <Field label={m('col.code')} required>
            <Input value={form.code} disabled={readOnly} autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ code: event.target.value })} />
          </Field>
        ) : null}
        <div className={styles.pair}>
          <Field label={m('col.zone')}>
            <Select
              value={form.zoneId}
              disabled={readOnly}
              translate="no"
              options={[...zones.map((z) => ({ value: z.id, label: `${z.code} · ${z.name}` })), { value: '', label: t('scopes.remote_pool') }]}
              onChange={(event) => change({ zoneId: event.target.value, shift: '', vehicleId: '', standbyId: '', ...((event.target.value === '') === remote ? {} : { eligible: [] }) })}
            />
          </Field>
          <Field label={m('d.homeShift')}>
            <Select value={form.shift} disabled={readOnly} translate="no" placeholder={t('common.none')} options={shiftChoices.map((s) => ({ value: s.code, label: s.name }))} onChange={(event) => change({ shift: event.target.value })} />
          </Field>
        </div>
        {remote ? null : (
          <div className={styles.pair}>
            <Field label={t('common.vehicle')}>
              <Select value={form.vehicleId} disabled={readOnly} translate="no" placeholder={t('common.none')} options={vehicleChoices.map((v) => ({ value: v.id, label: v.code }))} onChange={(event) => change({ vehicleId: event.target.value })} />
            </Field>
            <Field label={m('d.standby')}>
              <Select value={form.standbyId} disabled={readOnly} translate="no" placeholder={t('common.none')} options={standbyChoices.map((p) => ({ value: p.id, label: p.name }))} onChange={(event) => change({ standbyId: event.target.value })} />
            </Field>
          </div>
        )}
        <Field label={m('d.annual')}>
          <Input value={form.annual} disabled={readOnly} inputMode="numeric" dir="ltr" translate="no" autoComplete="off" onChange={(event) => change({ annual: event.target.value })} />
        </Field>
        <Stack gap={8}>
          <span className={styles.label}>{m('d.elig')}</span>
          <div className={styles.chips}>
            {shiftChoices.map((shift) => (
              <Button key={shift.id} variant={form.eligible.includes(shift.id) ? 'primary' : 'secondary'} size="sm" aria-pressed={form.eligible.includes(shift.id)} disabled={readOnly} onClick={() => change({ eligible: toggle(form.eligible, shift.id) })}>
                <span translate="no">{shift.name}</span>
              </Button>
            ))}
          </div>
          {form.eligible.some((id) => shiftChoices.some((s) => s.id === id)) ? null : <span className="t-caption">{m('d.eligAny')}</span>}
        </Stack>
        <Stack gap={8}>
          <span className={styles.label}>{m('d.skills')}</span>
          <div className={styles.chips}>
            {skills.map((skill) => (
              <Button key={skill.code} variant={form.skills.includes(skill.code) ? 'primary' : 'secondary'} size="sm" aria-pressed={form.skills.includes(skill.code)} disabled={readOnly} onClick={() => change({ skills: toggle(form.skills, skill.code) })}>
                <span translate="no">{skill.nameEn}</span>
              </Button>
            ))}
            {form.skills.filter((code) => !skills.some((s) => s.code === code)).map((code) => (
              <Tag key={code} color="gray">
                <span translate="no">{code}</span>
              </Tag>
            ))}
          </div>
        </Stack>
        <Stack gap={8}>
          <span className={styles.label}>{m('d.daysoff')}</span>
          <div className={styles.chips}>
            {DAYS.map((day) => (
              <Checkbox key={day} label={m(`day.${day}`)} checked={form.daysOff.includes(day)} disabled={readOnly} onChange={() => change({ daysOff: toggle(form.daysOff, day) })} />
            ))}
          </div>
        </Stack>
        <DescriptionList
          dense
          columns={1}
          items={[
            {
              label: m('d.handling'),
              value: (
                <span className={styles.chips}>
                  {m(`handling.${kind}`)}
                  <Qualifier>{m('inferred')}</Qualifier>
                </span>
              ),
            },
            ...(ownVehicle === undefined ? [] : [{ label: t('common.vehicle'), value: <span translate="no">{ownVehicle.code}</span> }]),
            ...(agent === undefined || agent.annualLeaveDays === null ? [] : [{ label: m('d.taken'), value: m('d.takenOf', { n: agent.annualLeaveTaken, m: agent.annualLeaveDays }) }]),
          ]}
        />
        {agent === undefined || agent.leave.length === 0 ? null : (
          <Stack gap={8}>
            <span className={styles.label}>{m('d.leave')}</span>
            {agent.leave.map((l, index) => (
              <div key={index} className={styles.leaveItem}>
                <span>{m(`leave.${l.type}`)}</span>
                <StatusPill status={m(`leave.${l.status}`)} tone={l.status === 'approved' ? 'success' : l.status === 'requested' ? 'info' : 'neutral'} size="sm" />
                <span className={styles.muted}>
                  {format.date(l.from)} - {format.date(l.to)}
                </span>
              </div>
            ))}
          </Stack>
        )}
        <Switch checked={form.active} disabled={readOnly} label={m('status.active')} onCheckedChange={(active) => change({ active })} />
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// The vehicle drawer
// ---------------------------------------------------------------------------------------------

interface VehicleForm {
  readonly code: string;
  readonly plate: string;
  readonly type: VehicleType | '';
  readonly zoneId: string;
  readonly active: boolean;
}

const vehicleForm = (row: VehicleRow | undefined, zones: readonly ZoneChoice[]): VehicleForm =>
  row === undefined ? { code: '', plate: '', type: 'sedan', zoneId: zones[0]?.id ?? '', active: true } : { code: row.code, plate: row.plate, type: row.type ?? '', zoneId: row.zoneId, active: row.active };

export interface VehicleDrawerProps {
  readonly vehicle: VehicleRow | undefined;
  readonly isNew: boolean;
  readonly canEdit: boolean;
  readonly zones: readonly ZoneChoice[];
  readonly maintenance?: MaintenanceByVehicle | undefined;
}

export function VehicleDrawer({ vehicle, isNew, canEdit, zones, maintenance }: VehicleDrawerProps) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const open = vehicle !== undefined || isNew;
  const key = !open ? '' : vehicle === undefined ? 'new' : vehicle.id;
  const [seen, setSeen] = useState(key);
  const [form, setForm] = useState<VehicleForm>(() => vehicleForm(vehicle, zones));
  if (key !== seen) {
    setSeen(key);
    setForm(vehicleForm(vehicle, zones));
  }
  const save = useAdminAction(saveVehicle, {
    successTitle: (result) => m(result.created ? 'toast.added.v' : 'toast.saved.v'),
    successDescription: (result) => result.name,
    onSuccess: () => url.update({ vehicle: null }, { history: 'replace', keepPage: true }),
  });
  if (!open) return <RecordDrawer open={false} param="vehicle" title="" />;

  const change = (patch: Partial<VehicleForm>) => {
    save.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  const need = isNew && form.code.trim() === '' ? m('need.code') : form.plate.trim() === '' ? m('need.plate') : null;
  const readOnly = !gate.edit.allowed;
  const footer = (
    <div className={styles.footer}>
      {need === null || !gate.edit.allowed ? null : <Reason icon={<Info />}>{need}</Reason>}
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => url.update({ vehicle: null }, { history: 'replace', keepPage: true })}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate.edit.reason ?? need} visible={false}>
        <Button
          variant="primary"
          loading={save.pending}
          onClick={() => {
            if (gate.edit.allowed && need === null) save.run({ ...(vehicle === undefined ? {} : { targetId: vehicle.id }), code: form.code.trim(), plate_number: form.plate.trim(), vehicle_type: form.type, zone_id: form.zoneId, is_active: form.active });
          }}
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  );
  return (
    <RecordDrawer open param="vehicle" recordKey={key} title={vehicle === undefined ? m('title.add.vehicle') : m('title.edit.vehicle')} subtitle={vehicle === undefined ? undefined : <span translate="no">{vehicle.code}</span>} footer={footer}>
      <Stack gap={16}>
        {isNew ? (
          <Field label={m('col.code')} required>
            <Input value={form.code} disabled={readOnly} autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ code: event.target.value })} />
          </Field>
        ) : null}
        <Field label={m('col.plate')} required>
          <Input value={form.plate} disabled={readOnly} maxLength={16} autoComplete="off" translate="no" dir="ltr" onChange={(event) => change({ plate: event.target.value })} />
        </Field>
        <div className={styles.pair}>
          <Field label={m('col.type')}>
            <Select value={form.type} disabled={readOnly} placeholder={t('common.none')} options={VEHICLE_TYPES.map((type) => ({ value: type, label: m(`type.${type}`) }))} onChange={(event) => change({ type: event.target.value as VehicleType | '' })} />
          </Field>
          <Field label={t('common.zone')}>
            <Select value={form.zoneId} disabled={readOnly} translate="no" options={zones.map((z) => ({ value: z.id, label: `${z.code} · ${z.name}` }))} onChange={(event) => change({ zoneId: event.target.value })} />
          </Field>
        </div>
        {vehicle === undefined ? null : <DescriptionList dense columns={1} items={[{ label: m('d.assign'), value: vehicle.assignedTo === null ? t('common.none') : <span translate="no">{vehicle.assignedTo}</span> }]} />}
        {vehicle === undefined ? null : <MaintenanceSection vehicleId={vehicle.id} items={maintenance?.[vehicle.id] ?? []} canEdit={canEdit} />}
        <Switch checked={form.active} disabled={readOnly} label={m('veh.in')} onCheckedChange={(active) => change({ active })} />
        <ActionError error={save.error} onDismiss={save.reset} />
      </Stack>
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// The skill dialog
// ---------------------------------------------------------------------------------------------

const SKILL_CODE = /^[a-z][a-z0-9_]{0,63}$/;

export function SkillDialog({ open, canEdit }: { open: boolean; canEdit: boolean }) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setCode('');
    setNameEn('');
    setNameAr('');
    if (!open) setDismissed(false);
  }
  const close = () => {
    setDismissed(true);
    url.update({ skill: null }, { history: 'replace', keepPage: true });
  };
  const add = useAdminAction(addSkillToVocabulary, { successTitle: m('toast.skill'), successDescription: (result) => result.code, onSuccess: close });
  const need = !SKILL_CODE.test(code.trim()) ? m('need.skillCode') : nameEn.trim() === '' ? m('need.name') : null;
  const reason = gate.edit.reason ?? need;
  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m('skill.new')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <ReasonHint reason={reason} visible={false}>
            <Button
              variant="primary"
              loading={add.pending}
              onClick={() => {
                if (reason === null) add.run({ code: code.trim(), name_en: nameEn.trim(), name_ar: nameAr.trim() });
              }}
            >
              {m('add.skill')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <Field label={m('col.code')} required hint={m('skill.code.hint')}>
          <Input value={code} autoComplete="off" translate="no" dir="ltr" onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label={m('col.name')} required>
          <Input value={nameEn} autoComplete="off" translate="no" onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label={m('col.ar')}>
          <Input value={nameAr} autoComplete="off" lang="ar" dir="rtl" onChange={(event) => setNameAr(event.target.value)} />
        </Field>
        <ActionError error={add.error} onDismiss={add.reset} />
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// The import dialog
// ---------------------------------------------------------------------------------------------

interface Chosen {
  readonly name: string;
  readonly text: string;
  readonly sample: boolean;
}

export function ImportDialog({ open, canEdit, sample }: { open: boolean; canEdit: boolean; sample: { readonly fileName: string; readonly text: string } | undefined }) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [readFailed, setReadFailed] = useState(false);
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
  const run = useAdminAction(importAgentsCsv, {
    successTitle: (result) => m('toast.imported', { n: result.agents }),
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
    if (file === undefined) return setChosen(null);
    try {
      setChosen({ name: file.name, text: await file.text(), sample: false });
    } catch {
      setChosen(null);
      setReadFailed(true);
    }
  }
  const reason = gate.edit.reason ?? (chosen === null ? m('need.file') : null);
  return (
    <Modal
      open={open && !dismissed}
      onClose={close}
      size="sm"
      title={m('importTitle')}
      description={m('importDesc')}
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
              {m('import')}
            </Button>
          </ReasonHint>
        </>
      }
    >
      <Stack gap={12}>
        <FileDrop key={round} accept=".csv" maxSize={MAX_FILE_BYTES} hint={m('importHint')} onFiles={(files) => void onFiles(files)} />
        {chosen?.sample === true ? (
          <Tag color="gray">
            <span translate="no">{chosen.name}</span>
          </Tag>
        ) : null}
        {readFailed ? <Alert tone="danger">{m('importReadFailed')}</Alert> : null}
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
              {m('importSample')}
            </Button>
          </div>
        )}
        <ActionError error={run.error} onDismiss={run.reset} />
      </Stack>
    </Modal>
  );
}
