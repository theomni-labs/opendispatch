'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Field, Input, Stack, StatusPill, useFormat } from '@opendispatch/ui';
import { CalendarOff, Info, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { addVehicleMaintenance, removeVehicleMaintenance } from './maintenance-actions';
import { LOCAL_MINUTE, type MaintenanceItem } from './maintenance-types';
import styles from './VehicleMaintenance.module.css';

// Spec 4.4: a vehicle's maintenance windows.

function When({ iso }: { iso: string }) {
  const format = useFormat();
  return (
    <bdi dir="ltr" translate="no">
      {format.date(iso)} {format.time(iso)}
    </bdi>
  );
}

// The Status cell while a window is open today.
export function MaintenanceStatus({ items }: { items: readonly MaintenanceItem[] | undefined }) {
  const m = useTranslations('admin.agents_vehicles');
  const format = useFormat();
  const now = items?.find((item) => item.active);
  if (now === undefined) return null;
  return (
    <>
      <StatusPill status={m('maint.in')} tone="warning" size="sm" />
      <span className={styles.sub}>{m('maint.until', { date: `${format.date(now.to)} ${format.time(now.to)}` })}</span>
    </>
  );
}

export interface MaintenanceSectionProps {
  readonly vehicleId: string;
  readonly items: readonly MaintenanceItem[];
  readonly canEdit: boolean;
}

// The drawer's Maintenance section.
export function MaintenanceSection({ vehicleId, items, canEdit }: MaintenanceSectionProps) {
  const m = useTranslations('admin.agents_vehicles');
  const t = useTranslations();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const add = useAdminAction(addVehicleMaintenance, {
    successTitle: m('toast.maint.added'),
    onSuccess: () => {
      setFrom('');
      setTo('');
      setReason('');
    },
  });
  const remove = useAdminAction(removeVehicleMaintenance, { successTitle: m('toast.maint.removed') });
  const readOnly = !gate.edit.allowed;
  const need = !LOCAL_MINUTE.test(from) || !LOCAL_MINUTE.test(to) || to <= from || reason.trim() === '' ? m('maint.need') : null;

  return (
    <Stack gap={8}>
      <span className={styles.label}>{m('maint.title')}</span>
      {items.length === 0 ? (
        <span className={styles.muted}>{t('common.none')}</span>
      ) : (
        items.map((item) => (
          <div key={item.id} className={styles.item}>
            {item.active ? <StatusPill status={m('maint.in')} tone="warning" size="sm" /> : null}
            <span className={styles.muted}>
              <When iso={item.from} /> - <When iso={item.to} />
            </span>
            <span translate="no">{item.reason}</span>
            <ReasonHint reason={gate.edit.reason} visible={false}>
              <Button variant="ghost" size="sm" startIcon={<Trash />} loading={remove.pending} onClick={() => gate.edit.allowed && remove.run({ id: item.id })}>
                {m('maint.remove')}
              </Button>
            </ReasonHint>
          </div>
        ))
      )}
      <div className={styles.pair}>
        <Field label={m('maint.from')}>
          <Input type="datetime-local" dir="ltr" value={from} disabled={readOnly} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={m('maint.to')}>
          <Input type="datetime-local" dir="ltr" value={to} disabled={readOnly} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>
      <Field label={t('common.reason')}>
        <Input value={reason} maxLength={200} disabled={readOnly} autoComplete="off" onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className={styles.item}>
        <ReasonHint reason={gate.edit.reason ?? need} visible={false}>
          <Button variant="secondary" size="sm" startIcon={<CalendarOff />} loading={add.pending} onClick={() => gate.edit.allowed && need === null && add.run({ vehicleId, from, to, reason: reason.trim() })}>
            {m('maint.add')}
          </Button>
        </ReasonHint>
        {need === null || readOnly || (from === '' && to === '' && reason === '') ? null : <Reason icon={<Info />}>{need}</Reason>}
      </div>
      <ActionError error={add.error ?? remove.error} onDismiss={() => (add.error === null ? remove.reset() : add.reset())} />
    </Stack>
  );
}
