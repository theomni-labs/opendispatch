'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, Card, Checkbox, Field, Input, QuantityInput, SegmentedControl, Select, StatusPill, Tag, type Tone } from '@opendispatch/ui';
import { Play, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ZonePicker, type PickerZone } from '@/components/opendispatch/patterns/ZonePicker';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { saveScenarioAction, runScenarioAction } from './actions';
import { patternLabel, remoteTotal, signed } from './changes';
import type { OptionItem, PatternOption } from './view';
import styles from './ScenarioLab.module.css';
import { HEADCOUNT_MAX, HEADCOUNT_MIN, SHARE_MAX, SHARE_MIN, SHARE_STEP, type RemoteMode, type ScenarioFormValues, type ScenarioStatus } from './types';

// Scenario editor (#sc2-ed), keyed per record

/** S0: no read for remote share; shown as baseline. */
const REMOTE_SHARE_BASELINE = 30;

const STATUS_TONE: Readonly<Record<ScenarioStatus, Tone>> = { draft: 'neutral', running: 'warning', completed: 'success', failed: 'danger' };

export interface EditorProps {
  readonly openId: string | null;
  readonly form: ScenarioFormValues;
  readonly zoneOptions: readonly PickerZone[];
  readonly patternOptions: readonly PatternOption[];
  readonly dateOptions: readonly OptionItem[];
  readonly status: ScenarioStatus;
  readonly lastRunLabel: string | null;
  readonly canEdit: boolean;
  /** An unsaved draft starts as changed. */
  readonly initialDirty?: boolean | undefined;
}

export function Editor({ openId, form, zoneOptions, patternOptions, dateOptions, status, lastRunLabel, canEdit, initialDirty = false }: EditorProps) {
  const m = useTranslations('ops.scenario_lab');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');

  const [name, setName] = useState(form.name);
  const [baseDate, setBaseDate] = useState(form.baseDate);
  const [zoneIds, setZoneIds] = useState<string[]>([...form.zoneIds]);
  const [field, setField] = useState(form.field);
  const [remote, setRemote] = useState(form.remote);
  const [remoteMode, setRemoteMode] = useState<RemoteMode>(form.remoteMode);
  const [remoteByZone, setRemoteByZone] = useState<Readonly<Record<string, number>>>(form.remoteByZone);
  const [veh, setVeh] = useState(form.veh);
  const [share, setShare] = useState<number | null>(form.sharePercent);
  const [patternIds, setPatternIds] = useState<string[]>([...form.patternIds]);
  const [dirty, setDirty] = useState(initialDirty);
  const [currentId, setCurrentId] = useState(openId);

  const touch = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  const remoteSum = remoteTotal({ mode: remoteMode, company: remote, byZone: remoteByZone }, zoneIds);

  // Switching keeps the pool change
  const changeRemoteMode = (next: string) => {
    const mode: RemoteMode = next === 'zone' ? 'zone' : 'company';
    if (mode === remoteMode) return;
    const first = zoneIds[0];
    if (mode === 'zone') setRemoteByZone(first === undefined ? {} : { [first]: remoteSum });
    else setRemote(remoteSum);
    setRemoteMode(mode);
    setDirty(true);
  };

  const setZoneRemote = (zoneId: string, n: number) => {
    setRemoteByZone((prev) => ({ ...prev, [zoneId]: n }));
    setDirty(true);
  };

  const zoneCodeOf = (id: string) => zoneOptions.find((z) => z.id === id)?.code ?? id;

  const togglePattern = (id: string, on: boolean) => {
    setPatternIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((p) => p !== id)));
    setDirty(true);
  };

  const save = useAdminAction(saveScenarioAction, {
    successTitle: m('toast.saved'),
    successDescription: name,
    onSuccess: (scenario) => {
      setCurrentId(scenario.id);
      setDirty(false);
      url.update({ scenario: scenario.id, tpl: null }, { history: 'replace', keepPage: true });
    },
  });

  const run = useAdminAction(runScenarioAction, {
    successTitle: m('toast.ran'),
    successDescription: (result) => m('toast.ranDesc', { g: result.gaps, s: result.surplus }),
  });

  const doSave = () =>
    save.run({ id: currentId, name, baseDate, zoneIds, field, remote, remoteMode, remoteByZone, veh, sharePercent: share, patternIds });
  const doRun = () => {
    if (currentId !== null) run.run({ id: currentId });
  };

  const runReason = currentId === null ? m('needsSave') : null;
  const shareLabel = share === null ? m('unchanged', { p: REMOTE_SHARE_BASELINE }) : `${String(share)}%`;

  return (
    <Card padding="lg">
      <div className={styles.editorHead}>
        <div className={styles.editorHeadTitle}>
          <h2 className={styles.cardTitle}>{m('ed.title')}</h2>
          <StatusPill status={m(`status.${status}`)} tone={STATUS_TONE[status]} size="sm" />
          {dirty ? <StatusPill status={m('stale')} tone="warning" size="sm" /> : null}
        </div>
        {lastRunLabel === null ? null : <span className={styles.lastRun}>{m('lastRun', { at: lastRunLabel })}</span>}
      </div>

      <div className={styles.editorGrid}>
        <Field label={m('f.name')}>
          <Input value={name} disabled={!canEdit} onChange={(e) => touch(setName)(e.target.value)} />
        </Field>
        <Field label={m('f.date')}>
          <Select value={baseDate} options={[...dateOptions]} disabled={!canEdit} onChange={(e) => touch(setBaseDate)(e.target.value)} />
        </Field>
        <ZonePicker
          legend={m('f.zones')}
          zones={zoneOptions}
          value={zoneIds}
          onChange={touch(setZoneIds)}
          disabled={!canEdit}
          required
          disabledHint={t('opendispatch.gate.viewOnly')}
        />
      </div>

      <div className={styles.editorGrid4}>
        <Field label={m('f.field')}>
          <QuantityInput value={field} min={HEADCOUNT_MIN} max={HEADCOUNT_MAX} step={1} uom={m('uom.zone')} disabled={!canEdit} onChange={touch(setField)} />
        </Field>
        <Field
          label={m('f.remote')}
          labelAction={
            <fieldset className={styles.bareFieldset} disabled={!canEdit}>
              <SegmentedControl
                size="sm"
                ariaLabel={m('f.remote')}
                value={remoteMode}
                options={[
                  { value: 'company', label: m('rmode.company') },
                  { value: 'zone', label: m('rmode.zone') },
                ]}
                onChange={changeRemoteMode}
              />
            </fieldset>
          }
        >
          {remoteMode === 'company' ? (
            <QuantityInput value={remote} min={HEADCOUNT_MIN} max={HEADCOUNT_MAX} step={1} uom={m('uom.company')} disabled={!canEdit} onChange={touch(setRemote)} />
          ) : (
            <output className={styles.remoteTotal}>{m('remoteTotal', { n: signed(remoteSum) })}</output>
          )}
        </Field>
        <Field label={m('f.vehicles')}>
          <QuantityInput value={veh} min={HEADCOUNT_MIN} max={HEADCOUNT_MAX} step={1} uom={m('uom.zone')} disabled={!canEdit} onChange={touch(setVeh)} />
        </Field>
        <Field label={m('f.share')} labelAction={<output className={styles.shareOut} dir="ltr">{shareLabel}</output>}>
          <input
            type="range"
            className={styles.range}
            min={SHARE_MIN}
            max={SHARE_MAX}
            step={SHARE_STEP}
            disabled={!canEdit}
            value={share ?? REMOTE_SHARE_BASELINE}
            aria-label={m('f.share')}
            onChange={(e) => touch(setShare)(Number(e.target.value) === REMOTE_SHARE_BASELINE ? null : Number(e.target.value))}
          />
        </Field>
      </div>

      {remoteMode === 'zone' ? (
        <div className={styles.remoteZones}>
          <Field label={m('f.remoteZones')}>
            <div className={styles.remoteZoneRow}>
              {zoneIds.map((zoneId) => (
                <div key={zoneId} className={styles.remoteZone}>
                  <Tag>
                    <span translate="no">{zoneCodeOf(zoneId)}</span>
                  </Tag>
                  <QuantityInput
                    value={remoteByZone[zoneId] ?? 0}
                    min={HEADCOUNT_MIN}
                    max={HEADCOUNT_MAX}
                    step={1}
                    uom={m('uom.thisZone')}
                    aria-label={`${m('f.remote')} ${zoneCodeOf(zoneId)}`}
                    disabled={!canEdit}
                    onChange={(n) => setZoneRemote(zoneId, n)}
                  />
                </div>
              ))}
            </div>
          </Field>
        </div>
      ) : null}

      <Field label={m('f.shifts')}>
        <div className={styles.patternRow}>
          {patternOptions.map((pattern) => (
            <Checkbox
              key={pattern.id}
              label={patternLabel(m, pattern.code)}
              checked={patternIds.includes(pattern.id)}
              disabled={!canEdit}
              onChange={(e) => togglePattern(pattern.id, e.target.checked)}
            />
          ))}
        </div>
      </Field>

      <ActionError error={save.error ?? run.error} onDismiss={save.error ? save.reset : run.reset} />

      <div className={styles.editorFooter}>
        {runReason === null || !gate.edit.allowed ? null : <Reason>{runReason}</Reason>}
        <ReasonHint reason={gate.edit.reason} visible={false}>
          <Button variant="secondary" startIcon={<Save />} loading={save.pending} onClick={doSave}>
            {t('common.save')}
          </Button>
        </ReasonHint>
        <ReasonHint reason={gate.edit.reason ?? runReason} visible={false}>
          <Button variant="primary" startIcon={<Play />} loading={run.pending} disabled={currentId === null} onClick={doRun}>
            {m('run')}
          </Button>
        </ReasonHint>
      </div>
    </Card>
  );
}
