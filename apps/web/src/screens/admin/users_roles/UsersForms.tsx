'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Badge, Button, DescriptionList, Field, Input, Menu, RadioGroup, Stack, Stepper, StatusPill, Tag, useFormat, useToast, type MenuEntry, type Tone } from '@opendispatch/ui';
import { ChevronDown, Download, FingerprintPattern, Info, KeyRound, Send, UserPlus, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { ConfirmDialog } from '@/components/opendispatch/patterns/ConfirmDialog';
import { RecordDrawer } from '@/components/opendispatch/patterns/RecordDrawer';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ZonePicker, type PickerZone } from '@/components/opendispatch/patterns/ZonePicker';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { isRole, scopeAppliesTo, type InstallMode, type Role } from '@/lib/access';
import { saveCsv } from '@/lib/export/download';
import { setDemoSession } from '@/lib/demo/actions';
import { AccessGroups } from './AccessGroups';
import { disableUserAccount, enableUserAccount, inviteUser, resetEmergencyMfa, resetEmergencyPassword, updateUserAccess } from './actions';
import type { AccessSummary, Matrices, RoleOption, UserRow, UserStatus } from './types';
import styles from './UsersRoles.module.css';

// The forms of the Users and Roles screen: the header's Invite and More, the invite drawer (person,
// role and zones, review), and the person's drawer (detail, edit, disable or enable, the emergency administrator's resets,
// "Switch to this user"). Every write is a server action through useAdminAction; the data layer authorises, validates and
// audits, and a role without `edit` sees the same controls disabled with the reason. Nothing here names the
// caller: the person acted on is a `targetUserId`, the role given is `assigned_role`.

const STATUS_TONE: Readonly<Record<UserStatus, Tone>> = { active: 'success', invited: 'info', disabled: 'neutral' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function StatusBadge({ status }: { status: UserStatus }) {
  const m = useTranslations('admin.users_roles');
  return <StatusPill status={m(`status.${status}`)} tone={STATUS_TONE[status]} size="sm" />;
}

// ---------------------------------------------------------------------------------------------
// The header: Invite user, and the More menu
// ---------------------------------------------------------------------------------------------

export function InviteButton({ canEdit, variant = 'primary', showReason = false }: { canEdit: boolean; variant?: 'primary' | 'secondary'; showReason?: boolean }) {
  const m = useTranslations('admin.users_roles');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const url = useUrlState();
  return (
    <ReasonHint reason={gate.edit.reason} visible={showReason}>
      <Button
        variant={variant}
        startIcon={<UserPlus />}
        onClick={() => {
          if (gate.edit.allowed) url.update({ new: '1' }, { history: 'push' });
        }}
      >
        {m('invite')}
      </Button>
    </ReasonHint>
  );
}

export interface UsersHeaderProps {
  readonly canEdit: boolean;
  readonly hasEmergencyAdmin: boolean;
  readonly exportFilename: string;
  readonly exportHeader: readonly string[];
  /** The rows on screen as text; undefined while the page shows a review state (no data was read). */
  readonly exportRows: readonly (readonly string[])[] | undefined;
}

/** The two header actions: Invite user (primary) and More (the emergency resets and Export). */
export function UsersHeader({ canEdit, hasEmergencyAdmin, exportFilename, exportHeader, exportRows }: UsersHeaderProps) {
  const m = useTranslations('admin.users_roles');
  const t = useTranslations();
  const toast = useToast();
  const resets = useEmergencyResets();

  const reason = !canEdit ? m('reason.adminOnly') : !hasEmergencyAdmin ? m('reason.noEmergency') : null;
  const items: MenuEntry[] = [
    ...(reason === null ? [] : [{ type: 'heading', label: reason } as const]),
    { label: m('reset.password'), icon: <KeyRound />, disabled: reason !== null, onSelect: () => resets.password.run() },
    { label: m('reset.mfa'), icon: <FingerprintPattern />, disabled: reason !== null, onSelect: () => resets.mfa.run() },
    'separator',
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
      <InviteButton canEdit={canEdit} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}

/** The two emergency administrator resets, as actions with their toasts. LABELLED STUBS: the toast says so. */
function useEmergencyResets() {
  const m = useTranslations('admin.users_roles');
  const t = useTranslations();
  const describe = (result: { hint: string }) => `${m('toast.reset.desc', { hint: result.hint })} ${t('patterns.stub.demo')}.`;
  const password = useAdminAction(resetEmergencyPassword, { successTitle: m('toast.pwd'), successDescription: describe, failureToast: true });
  const mfa = useAdminAction(resetEmergencyMfa, { successTitle: m('toast.mfa'), successDescription: describe, failureToast: true });
  return { password, mfa };
}

// ---------------------------------------------------------------------------------------------
// Role and zones (used by the invite drawer and by the edit form)
// ---------------------------------------------------------------------------------------------

interface RoleAndZonesProps {
  readonly roleOptions: readonly RoleOption[];
  readonly zones: readonly PickerZone[];
  readonly role: Role;
  readonly onRole: (role: Role) => void;
  readonly zoneIds: readonly string[];
  readonly onZones: (ids: string[]) => void;
  readonly disabled?: boolean;
  /** The picker itself asks for a zone (the edit form). The invite drawer says it in its footer instead, as the mockup does. */
  readonly askForZone?: boolean;
}

function RoleAndZones({ roleOptions, zones, role, onRole, zoneIds, onZones, disabled = false, askForZone = false }: RoleAndZonesProps) {
  const t = useTranslations();
  const m = useTranslations('admin.users_roles');
  const name = useId();
  const assigned = scopeAppliesTo(role) === 'assigned_zones';
  return (
    <Stack gap={20}>
      <Field label={m('col.role')}>
        <RadioGroup
          name={name}
          value={role}
          disabled={disabled}
          onChange={(next) => {
            if (isRole(next)) onRole(next);
          }}
          options={roleOptions.map((option) => ({
            value: option.role,
            label: t(`roles.${option.role}`),
            description: option.availableHere ? t(`scopes.${option.scope}`) : `${t(`scopes.${option.scope}`)} · ${m('reason.privateOnly')}`,
            disabled: !option.availableHere,
          }))}
        />
      </Field>
      <ZonePicker legend={t('common.zone')} zones={zones} value={zoneIds} onChange={onZones} disabled={disabled || !assigned} required={assigned && askForZone} disabledHint={m('zones.none')} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// The invite drawer: person, role and zones, review
// ---------------------------------------------------------------------------------------------

export interface InviteDrawerProps {
  /** `?new=1` and the person may edit. Decided on the server. */
  readonly open: boolean;
  readonly canEdit: boolean;
  readonly roleOptions: readonly RoleOption[];
  readonly zones: readonly PickerZone[];
  readonly matrices: Matrices;
  /** The install mode being administered: the review shows what the role can do here. */
  readonly installMode: InstallMode;
}

const FIRST_ROLE: Role = 'dispatcher';

export function InviteDrawer({ open, canEdit, roleOptions, zones, matrices, installMode }: InviteDrawerProps) {
  const t = useTranslations();
  const m = useTranslations('admin.users_roles');
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(FIRST_ROLE);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(1);
      setName('');
      setEmail('');
      setRole(FIRST_ROLE);
      setZoneIds([]);
    }
  }

  const invite = useAdminAction(inviteUser, {
    successTitle: m('toast.invited.title'),
    successDescription: (user) => m('toast.invited.desc', { name: user.name, role: t(`roles.${user.assignedRole}`) }),
    onSuccess: (user) => url.update({ new: null, id: user.id }, { history: 'replace', keepPage: true }),
  });

  const assigned = scopeAppliesTo(role) === 'assigned_zones';
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const need = step === 1 && (trimmedName === '' || !EMAIL.test(trimmedEmail)) ? m('need.person') : step === 2 && assigned && zoneIds.length === 0 ? m('need.zone') : null;
  const scopeLabel = t(`scopes.${scopeAppliesTo(role)}`);
  const zoneCodes = zones.filter((zone) => zoneIds.includes(zone.id)).map((zone) => zone.code);

  const steps = [{ label: m('w.person') }, { label: m('w.role') }, { label: m('w.review') }];
  const footer = (
    <div className={styles.footer}>
      {need === null ? null : (
        <Reason icon={<Info />}>{need}</Reason>
      )}
      <span className={styles.push} />
      {step > 1 ? (
        <Button variant="ghost" onClick={() => setStep(step - 1)}>
          {t('common.back')}
        </Button>
      ) : null}
      {step < 3 ? (
        <ReasonHint reason={need} visible={false}>
          <Button
            variant="primary"
            onClick={() => {
              if (need === null) setStep(step + 1);
            }}
          >
            {t('common.next')}
          </Button>
        </ReasonHint>
      ) : (
        <ReasonHint reason={gate.edit.reason} visible={false}>
          <Button
            variant="primary"
            startIcon={<Send />}
            loading={invite.pending}
            onClick={() => {
              if (gate.edit.allowed) invite.run({ email: trimmedEmail, display_name: trimmedName, assigned_role: role, zone_ids: assigned ? zoneIds : [] });
            }}
          >
            {m('w.send')}
          </Button>
        </ReasonHint>
      )}
    </div>
  );

  return (
    <RecordDrawer open={open} param="new" title={m('invite')} footer={footer}>
      <Stack gap={20}>
        <Stepper steps={steps} current={step - 1} />
        {step === 1 ? (
          <Stack gap={16}>
            <Field label={m('w.name')} required>
              <Input value={name} autoComplete="off" translate="no" onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={m('col.email')} required>
              <Input type="email" value={email} autoComplete="off" translate="no" dir="ltr" onChange={(event) => setEmail(event.target.value)} />
            </Field>
          </Stack>
        ) : null}
        {step === 2 ? <RoleAndZones roleOptions={roleOptions} zones={zones} role={role} onRole={setRole} zoneIds={zoneIds} onZones={setZoneIds} /> : null}
        {step === 3 ? (
          <Stack gap={16}>
            <DescriptionList
              dense
              columns={1}
              items={[
                { label: m('col.name'), value: <span translate="no">{trimmedName}</span> },
                { label: m('col.email'), value: <span translate="no">{trimmedEmail}</span> },
                { label: m('col.role'), value: t(`roles.${role}`) },
                { label: m('col.scope'), value: assigned ? <ZoneTags codes={zoneCodes} /> : scopeLabel },
              ]}
            />
            <Stack gap={8}>
              <h3 className={styles.sectionTitle}>{m('eff.title')}</h3>
              <AccessGroups summary={matrices[installMode].summary[role] ?? EMPTY_ACCESS} />
            </Stack>
            <ActionError error={invite.error} onDismiss={invite.reset} />
          </Stack>
        ) : null}
      </Stack>
    </RecordDrawer>
  );
}

const EMPTY_ACCESS: AccessSummary = { edit: [], view: [], approve: [], hidden: 0 };

/** Zone codes as gray tags, the first two, then "+N" (the mockup's scope cell). */
export function ZoneTags({ codes, limit = 2 }: { codes: readonly string[]; limit?: number }) {
  return (
    <span className={styles.zoneTags}>
      {codes.slice(0, limit).map((code) => (
        <Tag key={code} color="gray">
          <span translate="no">{code}</span>
        </Tag>
      ))}
      {codes.length > limit ? (
        <Badge size="sm" tone="neutral">
          <bdi dir="ltr" translate="no">
            +{codes.length - limit}
          </bdi>
        </Badge>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// The person's drawer: detail, edit, disable or enable, emergency resets, switch
// ---------------------------------------------------------------------------------------------

export interface UserDrawerProps {
  readonly user: UserRow | undefined;
  readonly access: AccessSummary | undefined;
  readonly canEdit: boolean;
  readonly roleOptions: readonly RoleOption[];
  readonly zones: readonly PickerZone[];
  /** The install mode being administered, for "Switch to this user" (the demo action checks it again). */
  readonly installMode: InstallMode;
  readonly hasEmergencyAdmin: boolean;
}

export function UserDrawer({ user, access, canEdit, roleOptions, zones, installMode, hasEmergencyAdmin }: UserDrawerProps) {
  const t = useTranslations();
  const m = useTranslations('admin.users_roles');
  const locale = useLocale();
  const format = useFormat();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const resets = useEmergencyResets();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('dispatcher');
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [seen, setSeen] = useState<string | undefined>(user?.id);
  if (user?.id !== seen) {
    setSeen(user?.id);
    setEditing(false);
    setConfirming(false);
    setSwitchError(null);
  }

  const update = useAdminAction(updateUserAccess, { successTitle: m('toast.updated'), successDescription: (person) => person.name, onSuccess: () => setEditing(false) });
  const disable = useAdminAction(disableUserAccount, { successTitle: m('toast.disabled'), successDescription: (person) => person.name, onSuccess: () => setConfirming(false) });
  const enable = useAdminAction(enableUserAccount, { successTitle: m('toast.enabled'), successDescription: (person) => person.name });
  const [switching, setSwitching] = useState(false);

  if (user === undefined) return <RecordDrawer open={false} title="" />;

  const assigned = user.scope === 'assigned_zones';
  const canSwitch = user.status === 'active' && !user.emergency;
  const disabled = user.status === 'disabled';
  const disableReason = user.disableBlock === 'self' ? m('reason.self') : user.disableBlock === 'lastAdmin' ? m('reason.lastAdmin') : gate.edit.reason;
  const resetReason = !canEdit ? m('reason.adminOnly') : null;
  const needsZone = editing && scopeAppliesTo(role) === 'assigned_zones' && zoneIds.length === 0 && !user.emergency;

  function startEditing() {
    if (user === undefined) return;
    setName(user.name);
    setRole(user.assignedRole);
    setZoneIds([...user.zoneIds]);
    update.reset();
    setEditing(true);
  }

  async function switchTo() {
    if (user === undefined || !canSwitch) return;
    setSwitchError(null);
    setSwitching(true);
    toast({ title: m('toast.switched', { role: t(`roles.${user.assignedRole}`) }), tone: 'info' });
    // An accepted choice redirects to the landing page of the new role and never returns; a refusal comes back.
    const result = await setDemoSession({ role: user.assignedRole, installMode, zoneIds: assigned ? [...user.zoneIds] : [] }, locale);
    setSwitching(false);
    if (result?.ok === false) setSwitchError(result.error === 'unknown_zone' ? t('demo.errorZone') : result.error === 'unavailable' ? t('demo.errorUnavailable') : t('demo.errorInvalid'));
  }

  const footer = editing ? (
    <div className={styles.footer}>
      <span className={styles.push} />
      <Button variant="ghost" onClick={() => setEditing(false)}>
        {t('common.cancel')}
      </Button>
      <ReasonHint reason={gate.edit.reason ?? (needsZone ? m('need.zone') : null)} visible={false}>
        <Button
          variant="primary"
          loading={update.pending}
          onClick={() => {
            if (gate.edit.allowed && !needsZone) update.run({ targetUserId: user.id, display_name: name.trim(), assigned_role: role, zone_ids: scopeAppliesTo(role) === 'assigned_zones' ? zoneIds : [] });
          }}
        >
          {t('common.save')}
        </Button>
      </ReasonHint>
    </div>
  ) : (
    <div className={styles.footer}>
      <span className={styles.stubRow}>
        <ReasonHint reason={canSwitch ? null : m('reason.switchInactive')} visible={false}>
          <Button variant="secondary" startIcon={<Users />} loading={switching} onClick={() => void switchTo()}>
            {m('d.switch')}
          </Button>
        </ReasonHint>
        <StubTag kind="demo" />
      </span>
      <span className={styles.push} />
      {disabled ? (
        <ReasonHint reason={gate.edit.reason} visible={false}>
          <Button variant="secondary" loading={enable.pending} onClick={() => gate.edit.allowed && enable.run({ targetUserId: user.id })}>
            {m('d.enable')}
          </Button>
        </ReasonHint>
      ) : (
        <ReasonHint reason={disableReason} visible={false}>
          <Button variant="secondary" onClick={() => !disableReason && setConfirming(true)}>
            {m('d.disable')}
          </Button>
        </ReasonHint>
      )}
    </div>
  );

  return (
    <>
      <RecordDrawer open recordKey={user.id} title={<span translate="no">{user.name}</span>} subtitle={<span translate="no">{user.email}</span>} footer={footer}>
        {editing ? (
          <Stack gap={20}>
            <Field label={m('w.name')} required>
              <Input value={name} autoComplete="off" translate="no" onChange={(event) => setName(event.target.value)} />
            </Field>
            <RoleAndZones roleOptions={roleOptions} zones={zones} role={role} onRole={setRole} zoneIds={zoneIds} onZones={setZoneIds} disabled={user.emergency} askForZone />
            <ActionError error={update.error} onDismiss={update.reset} />
          </Stack>
        ) : (
          <Stack gap={20}>
            <div className={styles.effectiveHead}>
              <StatusBadge status={user.status} />
              {user.emergency ? <Tag color="red">{m('emergency')}</Tag> : null}
              <span className={styles.push} />
              <ReasonHint reason={gate.edit.reason} visible={false}>
                <Button variant="secondary" size="sm" onClick={startEditing}>
                  {m('d.edit')}
                </Button>
              </ReasonHint>
            </div>
            <DescriptionList
              dense
              columns={1}
              items={[
                { label: m('col.role'), value: t(`roles.${user.assignedRole}`) },
                { label: m('col.scope'), value: assigned ? <ZoneTags codes={user.zoneCodes} /> : t(`scopes.${user.scope}`) },
                { label: m('col.last'), value: user.lastSignIn === null ? m('never') : `${format.date(user.lastSignIn)} ${format.time(user.lastSignIn)}` },
                { label: m('d.lang'), value: m(`lang.${user.language}`) },
              ]}
            />
            <Stack gap={8}>
              <h3 className={styles.sectionTitle}>{m('eff.title')}</h3>
              <AccessGroups summary={access ?? EMPTY_ACCESS} />
            </Stack>
            {user.emergency ? (
              <Stack gap={8}>
                <div className={styles.stubRow}>
                  <h3 className={styles.sectionTitle}>{m('d.emerg')}</h3>
                  <StubTag kind="demo" />
                </div>
                <div className={styles.chips}>
                  <ReasonHint reason={resetReason ?? (hasEmergencyAdmin ? null : m('reason.noEmergency'))} visible={false}>
                    <Button variant="secondary" size="sm" startIcon={<KeyRound />} loading={resets.password.pending} onClick={() => !resetReason && resets.password.run()}>
                      {m('d.pwd')}
                    </Button>
                  </ReasonHint>
                  <ReasonHint reason={resetReason ?? (hasEmergencyAdmin ? null : m('reason.noEmergency'))} visible={false}>
                    <Button variant="secondary" size="sm" startIcon={<FingerprintPattern />} loading={resets.mfa.pending} onClick={() => !resetReason && resets.mfa.run()}>
                      {m('d.mfa')}
                    </Button>
                  </ReasonHint>
                </div>
                {resetReason === null ? null : <Reason>{resetReason}</Reason>}
              </Stack>
            ) : null}
            {switchError === null ? null : (
              <Alert tone="danger" onDismiss={() => setSwitchError(null)}>
                {switchError}
              </Alert>
            )}
          </Stack>
        )}
      </RecordDrawer>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          disable.reset();
        }}
        onConfirm={() => disable.run({ targetUserId: user.id })}
        title={m('disable.title', { name: user.name })}
        description={m('disable.desc')}
        confirmLabel={m('disable.ok')}
        pending={disable.pending}
        error={<ActionError error={disable.error} onDismiss={disable.reset} />}
      />
    </>
  );
}
