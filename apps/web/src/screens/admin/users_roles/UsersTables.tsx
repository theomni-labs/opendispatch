'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, CardHeader, DataTable, SegmentedControl, Stack, useFormat, useToast, type Column, type Tone } from '@opendispatch/ui';
import { Ban, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ScrollCue } from '@/components/opendispatch/patterns/ScrollCue';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { INSTALL_MODES, MODULES, ROLES, type InstallMode, type Role } from '@/lib/access';
import { saveCsv } from '@/lib/export/download';
import { AccessGroups } from './AccessGroups';
import { disableUsers } from './actions';
import type { Matrices, ModeMatrix, RoleOption, UserStatus } from './types';
import styles from './UsersRoles.module.css';

// The tables of the Users and Roles screen (client files: the design system's DataTable takes functions, so the Server
// Component hands these plain data, and client-boundary.md). Nothing here reads a context, a customer or the
// caller's role: what a role may do is computed on the server (view.ts) and arrives as data.

// ---------------------------------------------------------------------------------------------
// The users list: AdminTable plus the bulk bar (Disable, Export)
// ---------------------------------------------------------------------------------------------

export interface BulkPerson {
  readonly id: string;
  readonly status: UserStatus;
  /** The row as text, in the order of `exportHeader` (the same cells "Export users" writes). */
  readonly exportCells: readonly string[];
}

export interface UsersTableProps {
  readonly columns: readonly AdminTableColumn[];
  readonly rows: readonly AdminTableRow[];
  readonly people: readonly BulkPerson[];
  readonly caption: string;
  readonly emptyState: ReactNode;
  readonly page?: number | undefined;
  /** True when the person has `edit` access. The screen is view only otherwise (the data layer refuses the writes as well). */
  readonly canEdit: boolean;
  readonly exportHeader: readonly string[];
  readonly exportFilename: string;
}

export function UsersTable({ columns, rows, people, caption, emptyState, page, canEdit, exportHeader, exportFilename }: UsersTableProps) {
  const m = useTranslations('admin.users_roles');
  const t = useTranslations();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const bulk = useAdminAction(disableUsers, {
    successTitle: (result) => m('toast.disabledN', { n: result.disabled }),
    successDescription: (result) =>
      result.failed === 0 ? undefined : (
        <>
          {m('bulk.failed', { n: result.failed })}{' '}
          <span lang="en" dir="ltr" translate="no">
            {result.firstProblem}
          </span>
        </>
      ),
    failureToast: true,
  });

  function disableSelected(ids: string[], clear: () => void) {
    if (!gate.edit.allowed) return;
    const targets = ids.filter((id) => people.find((p) => p.id === id)?.status !== 'disabled');
    if (targets.length === 0) return;
    bulk.run({ targetUserIds: targets });
    clear();
  }

  function exportSelected(ids: string[]) {
    saveCsv(exportFilename, { header: exportHeader, rows: people.filter((p) => ids.includes(p.id)).map((p) => [...p.exportCells]) });
    toast({ title: m('toast.export'), tone: 'info' });
  }

  return (
    <AdminTable
      caption={caption}
      columns={[...columns]}
      rows={[...rows]}
      emptyState={emptyState}
      page={page}
      selectable
      bulkActions={(ids, clear) => (
        <>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Ban />} loading={bulk.pending} onClick={() => disableSelected(ids, clear)}>
              {m('bulk.disable')}
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
// The Roles tab: install mode, the roles, effective access of the chosen role, the access matrix
// ---------------------------------------------------------------------------------------------

export interface RolesTabProps {
  /** The install mode the matrices open on: the mode being administered. */
  readonly defaultMode: InstallMode;
  readonly matrices: Matrices;
  readonly roleOptions: readonly RoleOption[];
  /** Number of people per assigned role. */
  readonly roleCounts: Readonly<Record<string, number>>;
}

interface RoleRow {
  readonly role: Role;
  readonly exists: boolean;
}

const CONSOLES = ['ops', 'admin'] as const;

function MatrixCellView({ access, approve }: { access: 'edit' | 'view' | 'none'; approve: boolean }) {
  const m = useTranslations('admin.users_roles');
  const level: { tone: Tone; key: string } | undefined = access === 'edit' ? { tone: 'accent', key: 'cell.edit' } : access === 'view' ? { tone: 'neutral', key: 'cell.view' } : undefined;
  if (level === undefined && !approve) return <span className={styles.muted}>-</span>;
  return (
    <span className={styles.cellBadges}>
      {level === undefined ? null : (
        <Badge tone={level.tone} size="sm">
          {m(level.key)}
        </Badge>
      )}
      {approve ? (
        <Badge tone="success" size="sm">
          {m('cell.approve')}
        </Badge>
      ) : null}
    </span>
  );
}

function Matrix({ matrix, selected }: { matrix: ModeMatrix; selected: Role }) {
  const t = useTranslations();
  const m = useTranslations('admin.users_roles');
  const existing = new Set<string>(matrix.roles);
  return (
    <div className={styles.matrixScroll}>
      <table className={styles.matrix} data-matrix="">
        <thead>
          <tr>
            <th scope="col" className={`${styles.stick} ${styles.stickHead}`}>
              {m('col.module')}
            </th>
            {ROLES.map((role) => (
              <th key={role} scope="col" className={`${styles.center} ${existing.has(role) ? '' : styles.dim}`} data-selected={role === selected ? '' : undefined}>
                {t(`roles.${role}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONSOLES.flatMap((console) => [
            <tr key={`group-${console}`}>
              <th scope="colgroup" colSpan={ROLES.length + 1} className={styles.groupHead}>
                {t(`shell.console.${console}`)}
              </th>
            </tr>,
            ...MODULES.filter((module) => module.console === console).map((module) => (
              <tr key={module.id}>
                <th scope="row" className={styles.stick}>
                  {t(module.menuKey)}
                </th>
                {ROLES.map((role) => {
                  const cell = matrix.cells[role]?.[module.id];
                  return (
                    <td key={role} className={styles.center} data-selected={role === selected ? '' : undefined}>
                      {!existing.has(role) || cell === undefined ? <span className={styles.muted}>-</span> : <MatrixCellView access={cell.access} approve={cell.approve} />}
                    </td>
                  );
                })}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

export function RolesTab({ defaultMode, matrices, roleOptions, roleCounts }: RolesTabProps) {
  const t = useTranslations();
  const m = useTranslations('admin.users_roles');
  const format = useFormat();
  const [mode, setMode] = useState<InstallMode>(defaultMode);
  const [selected, setSelected] = useState<Role>('administrator');
  const matrix = matrices[mode];
  const existing = new Set<string>(matrix.roles);

  const rows: RoleRow[] = roleOptions.map((option) => ({ role: option.role, exists: existing.has(option.role) }));
  const scopeOf = new Map(roleOptions.map((option) => [option.role, option.scope] as const));
  const columns: Column<RoleRow>[] = [
    {
      key: 'role',
      header: m('col.role'),
      cell: (row) => (
        <button type="button" className={styles.roleButton} aria-pressed={row.role === selected} data-role={row.role} onClick={() => setSelected(row.role)}>
          <span>{t(`roles.${row.role}`)}</span>
          {row.role === 'change_approver' ? <span className={styles.cellSub}>{m('shared.demo.privateOnly')}</span> : null}
        </button>
      ),
    },
    { key: 'scope', header: m('col.scope'), cell: (row) => t(`scopes.${scopeOf.get(row.role) ?? 'whole_install'}`) },
    { key: 'users', header: m('st.total'), align: 'end', cell: (row) => <bdi translate="no">{format.int(roleCounts[row.role] ?? 0)}</bdi> },
    { key: 'can', header: m('col.can'), hideBelow: 'md', cell: (row) => m(`can.${row.role}`) },
  ];

  return (
    <Stack gap={16}>
      <div className={styles.effectiveHead}>
        <span className={styles.groupLabel}>{m('shared.demo.install')}</span>
        <SegmentedControl
          size="sm"
          ariaLabel={m('shared.demo.install')}
          value={mode}
          options={INSTALL_MODES.map((option) => ({ value: option, label: t(`installModes.${option}`) }))}
          onChange={(next) => setMode((INSTALL_MODES as readonly string[]).includes(next) ? (next as InstallMode) : defaultMode)}
        />
      </div>
      <div className={styles.rolesGrid}>
        <Card padding="none">
          <CardHeader title={m('tab.roles')} />
          <ScrollCue>
            <DataTable columns={columns} rows={rows} getRowId={(row) => row.role} pageSize={0} caption={m('tab.roles')} rowTone={(row) => (row.role === selected ? 'accent' : undefined)} />
          </ScrollCue>
        </Card>
        <Card padding="lg">
          <Stack gap={12}>
            <h2 className={styles.sectionTitle}>{m('eff.title')}</h2>
            <div className={styles.effectiveHead}>
              <span className={styles.roleName}>{t(`roles.${selected}`)}</span>
              <Badge size="sm" tone="neutral">
                {t(`scopes.${scopeOf.get(selected) ?? 'whole_install'}`)}
              </Badge>
            </div>
            {existing.has(selected) ? <AccessGroups summary={matrix.summary[selected] ?? { edit: [], view: [], approve: [], hidden: 0 }} /> : <span className={styles.meta}>{m('reason.privateOnly')}</span>}
          </Stack>
        </Card>
      </div>
      <Card padding="none">
        <CardHeader title={m('matrix.title')} />
        <ScrollCue>
          <Matrix matrix={matrix} selected={selected} />
        </ScrollCue>
      </Card>
    </Stack>
  );
}
