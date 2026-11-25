'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Drawer, Field, RadioGroup, Select, Textarea } from '@opendispatch/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonHint } from '@/components/opendispatch/ReasonHint';
import { createOverrideAction } from './actions';
import { CHANGE_TYPES, REASON_CODES } from './types';
import type { OverrideDrawerOptions, PickerOption } from './view';
import type { OverrideChangeType, OverrideReasonCode } from '@/lib/types';

// Override drawer (#fp-drawer), reason-coded

const NEEDS: Readonly<Record<OverrideChangeType, readonly ('assignment' | 'agent' | 'shift' | 'vehicle')[]>> = {
  replace_agent: ['assignment', 'agent'],
  change_shift: ['assignment', 'shift'],
  change_vehicle: ['assignment', 'vehicle'],
  remove_assignment: ['assignment'],
  add_assignment: ['agent', 'shift'],
};

export interface OverrideDrawerProps {
  readonly rosterId: string;
  readonly zoneLabel: string;
  readonly date: string;
  readonly options: OverrideDrawerOptions;
  readonly disabledReason: string | null;
}

const optionsOf = (items: readonly PickerOption[]) => items.map((item) => ({ value: item.id, label: item.name }));

export function OverrideDrawer({ rosterId, zoneLabel, date, options, disabledReason }: OverrideDrawerProps) {
  const m = useTranslations('ops.field_planner');
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [changeType, setChangeType] = useState<OverrideChangeType>('replace_agent');
  const [assignmentId, setAssignmentId] = useState(options.assignments[0]?.id ?? '');
  const [agentId, setAgentId] = useState('');
  const [shiftPatternId, setShiftPatternId] = useState(options.shiftPatterns[0]?.id ?? '');
  const [vehicleId, setVehicleId] = useState('');
  const [reasonCode, setReasonCode] = useState<OverrideReasonCode | ''>('');
  const [note, setNote] = useState('');
  // A field's error shows once it was left empty
  const [touched, setTouched] = useState<ReadonlySet<'agent' | 'vehicle'>>(new Set());
  const touch = (field: 'agent' | 'vehicle') => setTouched((previous) => new Set(previous).add(field));

  const create = useAdminAction(createOverrideAction, {
    successTitle: m('toast.override'),
    successDescription: m('toast.overrideDesc'),
    onSuccess: () => {
      setOpen(false);
      setReasonCode('');
      setNote('');
      setAgentId('');
      setVehicleId('');
    },
  });

  const needs = NEEDS[changeType];
  const need = ((): 'assignment' | 'agent' | 'vehicle' | 'reason' | 'note' | null => {
    if (needs.includes('assignment') && assignmentId === '') return 'assignment';
    if (needs.includes('agent') && agentId === '') return 'agent';
    if (needs.includes('vehicle') && vehicleId === '') return 'vehicle';
    if (reasonCode === '') return 'reason';
    if (reasonCode === 'other' && note.trim() === '') return 'note';
    return null;
  })();

  const reset = () => {
    setChangeType('replace_agent');
    setAssignmentId(options.assignments[0]?.id ?? '');
    setAgentId('');
    setShiftPatternId(options.shiftPatterns[0]?.id ?? '');
    setVehicleId('');
    setReasonCode('');
    setNote('');
    setTouched(new Set());
    create.reset();
  };

  const submit = () => {
    if (need !== null || reasonCode === '') return;
    create.run({
      rosterId,
      change_type: changeType,
      reason_code: reasonCode,
      note: reasonCode === 'other' ? note.trim() : null,
      roster_assignment_id: needs.includes('assignment') ? assignmentId : null,
      agent_id: needs.includes('agent') ? agentId : null,
      shift_pattern_id: needs.includes('shift') ? shiftPatternId : null,
      vehicle_id: needs.includes('vehicle') ? vehicleId : changeType === 'add_assignment' ? vehicleId || null : null,
    });
  };

  return (
    <>
      <ReasonHint reason={disabledReason} visible={false}>
        <Button
          variant="primary"
          startIcon={<Plus />}
          onClick={() => {
            if (disabledReason !== null) return;
            reset();
            setOpen(true);
          }}
        >
          {m('add')}
        </Button>
      </ReasonHint>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={m('add')}
        subtitle={
          <span translate="no">
            {zoneLabel} · {date}
          </span>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <ReasonHint reason={need === null ? null : m(`need.${need}`)} visible={false}>
              <Button variant="primary" loading={create.pending} onClick={submit}>
                {m('d.submit')}
              </Button>
            </ReasonHint>
          </>
        }
      >
        <Field label={m('d.type')} required>
          <Select
            value={changeType}
            options={CHANGE_TYPES.map((code) => ({ value: code, label: m(`type.${code}`) }))}
            onChange={(event) => setChangeType(event.target.value as OverrideChangeType)}
          />
        </Field>
        {needs.includes('assignment') ? (
          <Field label={m('d.line')} required>
            <Select value={assignmentId} options={options.assignments.map((a) => ({ value: a.id, label: a.label }))} onChange={(event) => setAssignmentId(event.target.value)} />
          </Field>
        ) : null}
        {needs.includes('agent') ? (
          <Field label={m('d.new')} required error={touched.has('agent') && need === 'agent' ? m('need.agent') : undefined}>
            <Select
              value={agentId}
              placeholder={m('d.choose')}
              options={optionsOf(options.availableAgents)}
              onChange={(event) => setAgentId(event.target.value)}
              onBlur={() => touch('agent')}
              invalid={touched.has('agent') && need === 'agent'}
            />
          </Field>
        ) : null}
        {needs.includes('shift') ? (
          <Field label={m('d.shift')} required>
            <Select value={shiftPatternId} options={optionsOf(options.shiftPatterns)} onChange={(event) => setShiftPatternId(event.target.value)} />
          </Field>
        ) : null}
        {needs.includes('vehicle') || changeType === 'add_assignment' ? (
          <Field label={t('common.vehicle')} required={needs.includes('vehicle')} error={touched.has('vehicle') && need === 'vehicle' ? m('need.vehicle') : undefined}>
            <Select
              value={vehicleId}
              placeholder={m('d.choose')}
              options={optionsOf(options.vehicles)}
              onChange={(event) => setVehicleId(event.target.value)}
              onBlur={() => touch('vehicle')}
              invalid={touched.has('vehicle') && need === 'vehicle'}
            />
          </Field>
        ) : null}
        <Field label={t('common.reason')} required>
          <RadioGroup
            name="fp-reason"
            value={reasonCode}
            options={REASON_CODES.map((code) => ({ value: code, label: t(`opendispatch.reasonCode.${code}`) }))}
            onChange={(value) => setReasonCode(value as OverrideReasonCode)}
          />
        </Field>
        {reasonCode === 'other' ? (
          <Field label={t('common.note')} required>
            <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        ) : null}
        <ActionError error={create.error} onDismiss={create.reset} />
      </Drawer>
    </>
  );
}
