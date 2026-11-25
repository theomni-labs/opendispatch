'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Checkbox, RadioGroup, type RadioOption } from '@opendispatch/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { INSTALL_MODES, isInstallMode, isRole, scopeAppliesTo, type InstallMode, type Role } from '@/lib/access';
import { setDemoSession, signOutDemo } from '@/lib/demo/actions';
import styles from './DemoControls.module.css';

// The demo controls: install mode, role, zone scope. Used on the demo start page (a card) and
// in the top bar's Demo pop-over. They only pick values from fixed lists; the server action validates them again and
// builds the session. Nothing here decides what a role may see. oidc mode never uses them with the demo session.

export interface DemoOptionsView {
  readonly customerName: string;
  readonly zones: readonly { readonly id: string; readonly name: string; readonly cityName: string }[];
  readonly rolesByInstallMode: Readonly<Record<InstallMode, readonly Role[]>>;
}

export interface DemoSelection {
  readonly installMode: InstallMode;
  readonly role: Role;
  readonly zoneIds: readonly string[];
}

interface DemoControlsProps {
  variant: 'page' | 'panel';
  options: DemoOptionsView;
  initial: DemoSelection;
  submitLabel: string;
  /** Called after the action accepted the choice (the pop-over closes itself). */
  onDone?: () => void;
  /** Panel only: shows Sign out. */
  showSignOut?: boolean;
  /** Shown after the customer name, for example the data-source badge. */
  customerExtra?: ReactNode;
}

export function DemoControls({ variant, options, initial, submitLabel, onDone, showSignOut = false, customerExtra }: DemoControlsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [installMode, setInstallMode] = useState<InstallMode>(initial.installMode);
  const [role, setRole] = useState<Role>(initial.role);
  const [zoneIds, setZoneIds] = useState<readonly string[]>(initial.zoneIds);
  const [error, setError] = useState<string | null>(null);

  const roles = options.rolesByInstallMode[installMode];
  const scope = scopeAppliesTo(role);
  const zonesEnabled = scope === 'assigned_zones';

  const modeOptions: RadioOption[] = INSTALL_MODES.map((mode) => ({ value: mode, label: t(`installModes.${mode}`) }));
  const roleOptions: RadioOption[] = roles.map((code) => ({ value: code, label: t(`roles.${code}`), description: t(`scopes.${scopeAppliesTo(code)}`) }));

  function chooseMode(value: string) {
    if (!isInstallMode(value)) return;
    setInstallMode(value);
    // Change Approver exists only in private installs: fall back to the first role of the new mode.
    const available = options.rolesByInstallMode[value];
    if (!available.includes(role)) setRole(available[0] ?? role);
  }

  function chooseRole(value: string) {
    if (isRole(value)) setRole(value);
  }

  function toggleZone(id: string, checked: boolean) {
    setZoneIds((current) => (checked ? (current.includes(id) ? current : [...current, id]) : current.filter((zone) => zone !== id)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await setDemoSession({ role, installMode, zoneIds: zonesEnabled ? zoneIds : [] }, locale);
      // A accepted choice redirects and never returns a value; a refusal comes back as { ok: false }.
      if (result?.ok === false) {
        setError(result.error === 'unknown_zone' ? t('demo.errorZone') : result.error === 'unavailable' ? t('demo.errorUnavailable') : t('demo.errorInvalid'));
      } else {
        onDone?.();
      }
    });
  }

  return (
    <form className={styles.form} data-variant={variant} data-demo-switcher={variant === 'panel' ? 'panel' : undefined} onSubmit={submit}>
      {variant === 'panel' ? <div className={styles.heading}>{t('demo.controls')}</div> : null}

      {variant === 'page' ? (
        <div className={styles.customer}>
          <span className={styles.legend}>{t('demo.customer')}</span>
          <span className={styles.customerName}>{options.customerName}</span>
          {customerExtra}
        </div>
      ) : null}

      <div className={styles.group}>
        <span id={`${uid}-mode-legend`} className={styles.legend}>
          {t('demo.installMode')}
        </span>
        <RadioGroup name={`${uid}-mode`} orientation="horizontal" options={modeOptions} value={installMode} onChange={chooseMode} aria-labelledby={`${uid}-mode-legend`} />
      </div>

      <div className={styles.group}>
        <span id={`${uid}-role-legend`} className={styles.legend}>
          {t('demo.role')}
        </span>
        <RadioGroup className={styles.roles} name={`${uid}-role`} options={roleOptions} value={role} onChange={chooseRole} aria-labelledby={`${uid}-role-legend`} />
      </div>

      <div className={styles.group} role="group" aria-labelledby={`${uid}-zones-legend`} data-disabled={zonesEnabled ? undefined : 'true'}>
        <span id={`${uid}-zones-legend`} className={styles.legend}>
          {t('demo.zones')}
          {zonesEnabled ? null : <span className={styles.legendNote}>{t(`scopes.${scope}`)}</span>}
        </span>
        <div className={styles.zones}>
          {options.zones.map((zone) => (
            <Checkbox
              key={zone.id}
              label={zone.name}
              checked={zonesEnabled && zoneIds.includes(zone.id)}
              disabled={!zonesEnabled}
              onChange={(event) => toggleZone(zone.id, event.target.checked)}
            />
          ))}
        </div>
      </div>

      {error === null ? null : <Alert tone="danger">{error}</Alert>}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
        {showSignOut ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                await signOutDemo(locale);
              });
            }}
          >
            {t('common.signOut')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
