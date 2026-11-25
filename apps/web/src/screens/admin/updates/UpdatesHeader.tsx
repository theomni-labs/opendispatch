'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Menu, useToast, type MenuEntry } from '@opendispatch/ui';
import { ChevronDown, RefreshCw, Siren, Upload } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { checkNow } from './actions';
import { EmergencyDialog } from './UpdateDialogs';
import type { EmergencyChoices } from './types';

// The header of the Updates screen: "Check now" (the one primary action) and "More" (upload an update file, emergency override).
// The mockup's "Simulate a failed update", "Simulate a failed migration", "State" and "All states" are review tooling of the
// mockup and are not built: the scripted releases fail by themselves (1.3.0 rolls back, 1.3.1 stops partway).

interface EmergencyApi {
  readonly open: () => void;
}

const EmergencyContext = createContext<EmergencyApi | null>(null);

/**
 * Mounts the emergency override dialog once, so the header's More menu and the Change windows card can both open it.
 * It wraps the screen's frame (a Server Component may render a client provider around its own output).
 */
export function UpdatesProvider({ emergency, canEdit, children }: { emergency: EmergencyChoices; canEdit: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const api = useMemo<EmergencyApi>(() => ({ open: () => setOpen(true) }), []);
  return (
    <EmergencyContext.Provider value={api}>
      {children}
      <EmergencyDialog open={open} onClose={() => setOpen(false)} choices={emergency} canEdit={canEdit} onRun={() => undefined} />
    </EmergencyContext.Provider>
  );
}

/** Opens the emergency override dialog. Outside the provider (a test that renders one tab) it does nothing. */
export function useEmergencyDialog(): () => void {
  return useContext(EmergencyContext)?.open ?? (() => undefined);
}

export interface CheckNowButtonProps {
  readonly canEdit: boolean;
  /** Offline mode: the agent makes no outbound connection, so there is nothing to check. */
  readonly offline: boolean;
  readonly variant?: 'primary' | 'secondary';
}

export function CheckNowButton({ canEdit, offline, variant = 'primary' }: CheckNowButtonProps) {
  const m = useTranslations('admin.updates');
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const check = useAdminAction(checkNow, {
    quiet: true,
    onSuccess: (outcome) =>
      toast(
        outcome.result === 'update_found' && outcome.version !== null
          ? { title: m('toast.found', { v: outcome.version }), tone: 'info' }
          : outcome.result === 'failed'
            ? { title: m('toast.checkFailed'), tone: 'danger' }
            : { title: m('toast.uptodate'), tone: 'info' },
      ),
    failureToast: true,
  });
  const reason = gate.edit.reason ?? (offline ? m('check.offline') : null);
  return (
    <ReasonHint reason={reason} visible={false}>
      <Button variant={variant} startIcon={<RefreshCw />} loading={check.pending} onClick={() => reason === null && check.run()}>
        {m('check.label')}
      </Button>
    </ReasonHint>
  );
}

export function UpdatesHeader({ canEdit, offline }: { canEdit: boolean; offline: boolean }) {
  const m = useTranslations('admin.updates');
  const t = useTranslations();
  const url = useUrlState();
  const openEmergency = useEmergencyDialog();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const reason = gate.edit.reason;
  const items: MenuEntry[] = [
    ...(reason === null ? [] : [{ type: 'heading', label: reason } as const]),
    { label: m('menu.upload'), icon: <Upload />, disabled: reason !== null, onSelect: () => url.update({ tab: 'connection' }, { history: 'push' }) },
    { label: m('menu.emergency'), icon: <Siren />, disabled: reason !== null, onSelect: openEmergency },
  ];
  return (
    <>
      <CheckNowButton canEdit={canEdit} offline={offline} />
      <Menu align="end" label={t('common.more')} trigger={<Button variant="secondary" endIcon={<ChevronDown />}>{t('common.more')}</Button>} items={items} />
    </>
  );
}
