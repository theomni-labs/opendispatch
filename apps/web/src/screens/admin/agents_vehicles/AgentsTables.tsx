'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, CardHeader, DescriptionList, EmptyState, Input, StatusPill, Tag, useFormat, useToast } from '@opendispatch/ui';
import { Ban, Download, Lock, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import type { SortParam } from '@/components/opendispatch/patterns/search-params';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveCsv } from '@/lib/export/download';
import { removeSkillFromVocabulary, renameSkill, setAgentsInactive } from './actions';
import type { LeaveStatus, SkillRow, AgentRow, VehicleRow } from './types';
import type { MaintenanceByVehicle } from './maintenance-types';
import { MaintenanceStatus } from './VehicleMaintenance';
import styles from './AgentsVehicles.module.css';

// The tables of the Agents and Vehicles screen (client files: the design system's DataTable takes functions, so the Server
// Component hands these plain data, and client-boundary.md). A row opens its drawer through the address
// (`?agent=<id>`, `?vehicle=<id>`, a push, so Back closes it). Nothing here reads a context or the caller's role.

const LEAVE_TONE = { approved: 'success', requested: 'info', declined: 'neutral' } as const satisfies Record<LeaveStatus, 'success' | 'info' | 'neutral'>;

export function ActiveStatus({ active, kind }: { active: boolean; kind: 'agent' | 'vehicle' }) {
  const m = useTranslations('admin.agents_vehicles');
  const label = kind === 'vehicle' ? (active ? 'veh.in' : 'veh.out') : active ? 'status.active' : 'status.inactive';
  return <StatusPill status={m(label)} tone={active ? 'success' : 'neutral'} size="sm" />;
}

// ---------------------------------------------------------------------------------------------
// Agents, with the bulk bar (Set inactive, Export)
// ---------------------------------------------------------------------------------------------

export interface AgentsTableProps {
  readonly rows: readonly AgentRow[];
  /** Skill names by code, from the vocabulary; a code with no name shows as it is. */
  readonly skillNames: Readonly<Record<string, string>>;
  readonly caption: string;
  readonly canEdit: boolean;
  readonly emptyState: ReactNode;
  readonly exportHeader: readonly string[];
  readonly exportRows: readonly (readonly string[])[];
  readonly exportFilename: string;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
}

export function AgentsTable({ rows, skillNames, caption, canEdit, emptyState, exportHeader, exportRows, exportFilename, sort, page }: AgentsTableProps) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const format = useFormat();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const bulk = useAdminAction(setAgentsInactive, {
    successTitle: (result) => m('toast.inactive', { n: result.changed }),
    successDescription: (result) =>
      result.failed === 0 ? undefined : (
        <span lang="en" dir="ltr" translate="no">
          {result.firstProblem}
        </span>
      ),
    failureToast: true,
  });

  const columns: AdminTableColumn[] = [
    { key: 'name', header: m('col.name'), sortable: true },
    { key: 'zone', header: m('col.zone'), sortable: true },
    { key: 'shift', header: m('f.shift') },
    { key: 'skills', header: m('d.skills'), hideBelow: 'md' },
    { key: 'vehicle', header: t('common.vehicle'), hideBelow: 'md' },
    { key: 'status', header: t('common.status') },
    { key: 'leave', header: m('col.leave'), hideBelow: 'lg' },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => {
    const leave = row.leave.find((l) => l.status === 'requested') ?? row.leave.find((l) => l.status === 'approved') ?? row.leave[0];
    return {
      id: row.id,
      label: row.name,
      sort: { name: row.name, zone: row.zoneCode ?? '~' },
      cells: {
        name: (
          <>
            <span className={styles.cellMain} translate="no">
              {row.name}
            </span>
            <span className={styles.cellSub} translate="no">
              {row.code}
            </span>
          </>
        ),
        zone:
          row.zoneCode === null ? (
            <span>{t('scopes.remote_pool')}</span>
          ) : (
            <Tag color="gray">
              <span translate="no">{row.zoneCode}</span>
            </Tag>
          ),
        shift: row.shiftName === null ? <span className={styles.muted}>-</span> : <span translate="no">{row.shiftName}</span>,
        skills:
          row.skills.length === 0 ? (
            <span className={styles.muted}>-</span>
          ) : (
            <span className={styles.chips}>
              {row.skills.slice(0, 2).map((code) => (
                <Tag key={code} color="geekblue">
                  <span translate="no">{skillNames[code] ?? code}</span>
                </Tag>
              ))}
              {row.skills.length > 2 ? (
                <Badge size="sm" tone="neutral">
                  <bdi translate="no">+{format.int(row.skills.length - 2)}</bdi>
                </Badge>
              ) : null}
            </span>
          ),
        vehicle: row.vehicleCode === null ? <span className={styles.muted}>-</span> : <span translate="no">{row.vehicleCode}</span>,
        status: <ActiveStatus active={row.active} kind="agent" />,
        leave: leave === undefined ? <span className={styles.muted}>-</span> : <StatusPill status={m(`leave.${leave.status}`)} tone={LEAVE_TONE[leave.status]} size="sm" />,
      },
    };
  });

  function setInactive(ids: string[], clear: () => void) {
    if (!gate.edit.allowed) return;
    const targets = ids.filter((id) => rows.find((r) => r.id === id)?.active === true);
    if (targets.length === 0) return;
    bulk.run({ targetIds: targets });
    clear();
  }

  function exportSelected(ids: string[]) {
    const chosen = new Set(ids);
    saveCsv(exportFilename, { header: [...exportHeader], rows: exportRows.filter((_, index) => chosen.has(rows[index]?.id ?? '')).map((row) => [...row]) });
    toast({ title: m('toast.export'), tone: 'info' });
  }

  return (
    <AdminTable
      caption={caption}
      columns={columns}
      rows={tableRows}
      rowParam="agent"
      emptyState={emptyState}
      selectable
      sort={sort}
      page={page}
      bulkActions={(ids, clear) => (
        <>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Ban />} loading={bulk.pending} onClick={() => setInactive(ids, clear)}>
              {m('bulk.inactive')}
            </Button>
          </ReasonHint>
          <Button variant="secondary" size="sm" startIcon={<Download />} onClick={() => exportSelected(ids)}>
            {t('common.export')}
          </Button>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

export interface VehiclesTableProps {
  readonly rows: readonly VehicleRow[];
  readonly caption: string;
  readonly emptyState: ReactNode;
  readonly sort?: SortParam | undefined;
  readonly page?: number | undefined;
  readonly maintenance?: MaintenanceByVehicle | undefined;
}

export function VehiclesTable({ rows, caption, emptyState, sort, page, maintenance }: VehiclesTableProps) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const columns: AdminTableColumn[] = [
    { key: 'vehicle', header: t('common.vehicle'), sortable: true },
    { key: 'type', header: m('col.type'), hideBelow: 'md' },
    { key: 'zone', header: t('common.zone'), sortable: true },
    { key: 'assigned', header: m('d.assign') },
    { key: 'status', header: t('common.status') },
  ];
  const tableRows: AdminTableRow[] = rows.map((row) => ({
    id: row.id,
    label: row.code,
    sort: { vehicle: row.code, zone: row.zoneCode },
    cells: {
      vehicle: (
        <>
          <span className={styles.cellMain} translate="no">
            {row.code}
          </span>
          <span className={styles.cellSub} translate="no" dir="ltr">
            {row.plate}
          </span>
        </>
      ),
      type: row.type === null ? <span className={styles.muted}>-</span> : m(`type.${row.type}`),
      zone: (
        <Tag color="gray">
          <span translate="no">{row.zoneCode}</span>
        </Tag>
      ),
      assigned: row.assignedTo === null ? <span className={styles.muted}>{t('common.none')}</span> : <span translate="no">{row.assignedTo}</span>,
      status: maintenance?.[row.id]?.some((w) => w.active) ? <MaintenanceStatus items={maintenance[row.id]} /> : <ActiveStatus active={row.active} kind="vehicle" />,
    },
  }));
  return <AdminTable caption={caption} columns={columns} rows={tableRows} rowParam="vehicle" emptyState={emptyState} sort={sort} page={page} />;
}

// ---------------------------------------------------------------------------------------------
// The skill vocabulary
// ---------------------------------------------------------------------------------------------

/** The vocabulary as chips, and the chosen skill's card. */
export function SkillsPanel({ skills, canEdit }: { skills: readonly SkillRow[]; canEdit: boolean }) {
  const m = useTranslations('admin.agents_vehicles');
  const format = useFormat();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  const [picked, setPicked] = useState<string | null>(null);
  const skill = skills.find((s) => s.code === picked) ?? skills[0];
  return (
    <div className={styles.detailGrid}>
      <Card padding="none">
        <CardHeader
          title={m('skills.title')}
          actions={
            <ReasonHint reason={gate.edit.reason} visible={false}>
              <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => gate.edit.allowed && url.update({ skill: 'new' }, { history: 'push', keepPage: true })}>
                {m('add.skill')}
              </Button>
            </ReasonHint>
          }
        />
        {skills.length === 0 ? (
          <EmptyState compact title={m('skill.none')} />
        ) : (
          <div className={styles.skillChips}>
            {skills.map((s) => (
              <button key={s.code} type="button" className={styles.skillChip} aria-pressed={s.code === skill?.code} data-skill={s.code} onClick={() => setPicked(s.code)}>
                <span translate="no">{s.nameEn}</span>
                <Badge tone="neutral" size="sm">
                  <bdi translate="no">{format.int(s.inUse)}</bdi>
                </Badge>
              </button>
            ))}
          </div>
        )}
      </Card>
      <SkillDetail key={skill?.code ?? 'none'} skill={skill} canEdit={canEdit} onRemoved={() => setPicked(null)} />
    </div>
  );
}

function SkillDetail({ skill, canEdit, onRemoved }: { skill: SkillRow | undefined; canEdit: boolean; onRemoved: () => void }) {
  const m = useTranslations('admin.agents_vehicles');
  const format = useFormat();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [nameAr, setNameAr] = useState('');
  const rename = useAdminAction(renameSkill, { successTitle: m('toast.ar'), successDescription: (result) => result.code });
  const remove = useAdminAction(removeSkillFromVocabulary, { successTitle: m('toast.skillRemoved'), successDescription: (result) => result.code, onSuccess: onRemoved });
  if (skill === undefined) {
    return (
      <Card padding="lg">
        <CardHeader title={m('skill.pick')} />
      </Card>
    );
  }
  const inUse = skill.inUse > 0 ? m('skill.in', { n: format.int(skill.inUse) }) : null;
  const saveReason = gate.edit.reason ?? (nameAr.trim() === '' ? m('need.name') : null);
  const removeReason = gate.edit.reason ?? inUse;
  const arabic =
    skill.nameAr === null ? (
      <span className={styles.skillDetail}>
        <span className={styles.inlineRow}>
          <Input size="sm" value={nameAr} lang="ar" dir="rtl" autoComplete="off" aria-label={m('col.ar')} disabled={!canEdit} onChange={(event) => setNameAr(event.target.value)} />
          <ReasonHint reason={saveReason} visible={false}>
            <Button variant="secondary" size="sm" loading={rename.pending} onClick={() => saveReason === null && rename.run({ code: skill.code, name_ar: nameAr.trim() })}>
              {m('skill.ar.add')}
            </Button>
          </ReasonHint>
        </span>
        <span className={styles.cellSub}>{m('skill.ar.fallback')}</span>
      </span>
    ) : (
      <span className={styles.cellMain} lang="ar" dir="rtl">
        {skill.nameAr}
      </span>
    );
  return (
    <Card padding="lg">
      <div className={styles.skillDetail}>
        <h2 className={styles.detailTitle} translate="no">
          {skill.nameEn}
        </h2>
        <DescriptionList
          dense
          columns={1}
          items={[
            { label: m('col.code'), value: <bdi translate="no">{skill.code}</bdi> },
            { label: m('tab.agents'), value: <bdi translate="no">{format.int(skill.inUse)}</bdi> },
            { label: m('col.ar'), value: arabic },
          ]}
        />
        <ActionError error={rename.error} onDismiss={rename.reset} />
        <span>
          <ReasonHint reason={removeReason} visible={false}>
            <Button variant="secondary" size="sm" loading={remove.pending} onClick={() => removeReason === null && remove.run({ code: skill.code })}>
              {m('skill.remove')}
            </Button>
          </ReasonHint>
        </span>
        {inUse === null ? null : <Reason icon={<Lock />}>{inUse}</Reason>}
        <ActionError error={remove.error} onDismiss={remove.reset} />
      </div>
    </Card>
  );
}
