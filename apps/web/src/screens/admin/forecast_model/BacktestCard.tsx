'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, DataTable, DescriptionList, Drawer, EmptyState, SkeletonText, StatusPill, Tooltip, useFormat, type Column, type Tone } from '@opendispatch/ui';
import { LineChart } from '@opendispatch/ui/charts';
import { ArrowDownRight, ArrowUpRight, ChartLine, ChevronDown, ChevronRight, ChevronUp, Play, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { DataSourceBadge } from '@/components/opendispatch/DataSourceBadge';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { useRouter } from '@/i18n/navigation';
import { startBacktest } from './actions';
import { FEW_CASES, gateArm, improvementOf, isStale, mapeStatus, resultKey, sourcesOf, worstHours, type BacktestCardData, type BacktestLatest, type BacktestZone, type GateResult } from './backtest';
import styles from './ForecastModel.module.css';

// Backtest card (#fm-bt): gate, errors, weak zones.

const GATE_TONE: Readonly<Record<GateResult, Tone>> = { pass: 'success', fail: 'danger', not_enough_history: 'warning' };
const POLL_MS = 5000;
const SHOWN = 5;
const WAPE = <span translate="no">WAPE</span>;

interface MeasureRow {
  readonly key: string;
  readonly name: string;
  readonly tip: string;
  readonly sub: string;
  readonly model: number | null | undefined;
  readonly naive: number | null | undefined;
  readonly segment: number | null | undefined;
  readonly gate: number | null | undefined;
  readonly ratio: boolean;
}

function Delta({ value }: { value: number | null }) {
  const m = useTranslations('admin.forecast_model');
  const format = useFormat();
  if (value === null) return <span className={styles.meta}>-</span>;
  const good = value >= 0;
  return (
    <span className={good ? styles.deltaGood : styles.deltaBad}>
      {good ? <ArrowDownRight aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
      <bdi dir="ltr" translate="no">
        {format.ratio(Math.abs(value), 1)}
      </bdi>
      <span className={styles.srOnly}>{m(good ? 'bt.better' : 'bt.worse')}</span>
    </span>
  );
}

function Section({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.btSection}>
      <div className={styles.btSectionHead}>
        <h3 className={styles.btSectionTitle}>{title}</h3>
        {extra}
      </div>
      {children}
    </div>
  );
}

function ZoneDrawer({ zone, name, onClose }: { zone: BacktestZone | null; name: string; onClose: () => void }) {
  const m = useTranslations('admin.forecast_model');
  const format = useFormat();
  const hours = zone?.hours ?? [];
  const few = zone !== null && (zone.actual_total < FEW_CASES || hours.length === 0);
  const worst = zone === null ? [] : worstHours(zone);
  const byHour = new Map(hours.map((h) => [h.hour, h] as const));
  const labels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  return (
    <Drawer
      open={zone !== null}
      onClose={onClose}
      title={<bdi translate="no">{name}</bdi>}
      subtitle={
        <span className={styles.inline}>
          {m('bt.hourly')} <IllustrativeLabel />
        </span>
      }
    >
      {zone === null ? null : few ? (
        <EmptyState compact icon={<ChartLine />} title={m('bt.fewCases')} />
      ) : (
        <div className={styles.cardInner}>
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: 'WAPE', value: <span translate="no">{format.ratio(zone.wape, 1)}</span> },
              { label: m('bt.col.baselineWape'), value: <span translate="no">{format.ratio(zone.baseline_wape, 1)}</span> },
              { label: m('bt.col.cases'), value: <span translate="no">{format.int(zone.actual_total)}</span> },
              { label: m('bt.worstHour'), value: <span translate="no">{worst[0] === undefined ? '-' : format.time(worst[0].hour * 60)}</span> },
            ]}
          />
          <LineChart
            label={m('bt.hourly')}
            labels={labels}
            min={0}
            height={200}
            format={(v) => format.ratio(v, 0)}
            series={[
              { name: m('bt.col.model'), data: labels.map((_, h) => byHour.get(h)?.wape ?? 0), color: 'var(--od-chart-1)' },
              { name: m('bt.col.baseline'), data: labels.map((_, h) => byHour.get(h)?.baseline_wape ?? 0), color: 'var(--od-chart-4)', dashed: true },
            ]}
          />
          <h3 className={styles.btSectionTitle}>{m('bt.worstHours')}</h3>
          <DataTable
            dense
            pageSize={0}
            caption={m('bt.worstHours')}
            rows={[...worst]}
            getRowId={(row) => String(row.hour)}
            columns={[
              { key: 'hour', header: m('bt.col.hour'), cell: (row) => <span translate="no">{format.time(row.hour * 60)}</span> },
              { key: 'wape', header: WAPE, align: 'end', cell: (row) => <b translate="no">{format.ratio(row.wape, 1)}</b> },
              { key: 'base', header: m('bt.col.baseline'), align: 'end', cell: (row) => <span translate="no">{format.ratio(row.baseline_wape, 1)}</span> },
            ]}
          />
        </div>
      )}
    </Drawer>
  );
}

function Filled({ latest, zoneNames, stale, activeModel, warn }: { latest: BacktestLatest; zoneNames: Readonly<Record<string, string>>; stale: boolean; activeModel: string; warn: readonly string[] }) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const format = useFormat();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<BacktestZone | null>(null);
  const base = gateArm(latest);
  const imp = latest.gate.improvement ?? improvementOf(latest.engine.wape, base.wape);
  const res = resultKey(imp, latest.gate.min_improvement);
  const span = (from: string | null | undefined, to: string | null | undefined) =>
    from == null || to == null ? '-' : (
      <bdi translate="no">
        {format.date(from)} - {format.date(to)}
      </bdi>
    );
  const notes = [...warn, ...(latest.gate.result === 'not_enough_history' ? [m('bt.shortHist')] : []), ...(stale ? [m('bt.staleNote', { old: latest.model_version, cur: activeModel })] : [])];

  const measures: MeasureRow[] = [
    { key: 'wape', name: 'WAPE', tip: m('bt.tip.wape'), sub: m('bt.sub.wape'), model: latest.engine.wape, naive: latest.naive.wape, segment: latest.segment?.wape, gate: base.wape, ratio: true },
    { key: 'mape', name: 'MAPE', tip: m('bt.tip.mape'), sub: m('bt.sub.mape'), model: latest.engine.mape, naive: latest.naive.mape, segment: latest.segment?.mape, gate: base.mape, ratio: true },
    { key: 'mae', name: 'MAE', tip: m('bt.tip.mae'), sub: m('bt.sub.cases'), model: latest.engine.mae, naive: latest.naive.mae, segment: latest.segment?.mae, gate: base.mae, ratio: false },
    { key: 'rmse', name: 'RMSE', tip: m('bt.tip.rmse'), sub: m('bt.sub.cases'), model: latest.engine.rmse, naive: latest.naive.rmse, segment: latest.segment?.rmse, gate: base.rmse, ratio: false },
  ];
  const value = (row: MeasureRow, v: number | null | undefined) => (v == null ? '-' : row.ratio ? format.ratio(v, 1) : format.num(v, 1));
  const measureCols: Column<MeasureRow>[] = [
    {
      key: 'measure',
      header: m('bt.col.measure'),
      cell: (row) => (
        <span className={styles.stackTight}>
          <Tooltip content={row.tip}>
            <span className={styles.strong} translate="no" tabIndex={0}>
              {row.name}
            </span>
          </Tooltip>
          <span className={styles.meta}>{row.sub}</span>
        </span>
      ),
    },
    { key: 'model', header: m('bt.col.model'), align: 'end', cell: (row) => <b translate="no">{value(row, row.model)}</b> },
    { key: 'naive', header: m('bt.col.naive'), align: 'end', cell: (row) => <span translate="no">{value(row, row.naive)}</span> },
    { key: 'segment', header: m('bt.col.segment'), align: 'end', cell: (row) => <span translate="no">{value(row, row.segment)}</span> },
    { key: 'change', header: m('bt.col.change'), align: 'end', cell: (row) => <Delta value={improvementOf(row.model, row.gate)} /> },
  ];
  const rangeFooter = (
    <>
      <td>
        <span className={styles.stackTight}>
          <span className={styles.strong}>{m('bt.range')}</span>
          <span className={styles.meta}>{m('bt.sub.range')}</span>
        </span>
      </td>
      <td data-align="end">
        <b translate="no">{format.ratio(latest.engine.range_coverage, 0)}</b>
      </td>
      <td data-align="end">-</td>
      <td data-align="end">-</td>
      <td data-align="end">-</td>
    </>
  );

  const chall = latest.challenger;
  const challRows = chall == null ? [] : [
    { key: 'wape', name: 'WAPE', tip: m('bt.tip.wape'), champion: chall.champion_wape, challenger: chall.challenger_wape, lift: chall.wape_lift },
    { key: 'mape', name: 'MAPE', tip: m('bt.tip.mape'), champion: chall.champion_mape, challenger: chall.challenger_mape, lift: chall.mape_lift },
  ];
  const signed = (v: number | null | undefined) => (v == null ? '-' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${format.ratio(Math.abs(v), 1)}`);

  const dayRows = [
    { key: 'ev', name: m('bt.evDays'), sub: m('bt.sub.ev'), d: latest.event_days },
    { key: 'ord', name: m('bt.ordDays'), sub: m('bt.sub.ord'), d: latest.ordinary_days },
  ];
  const zones = all ? latest.weakest_zones : latest.weakest_zones.slice(0, SHOWN);
  const nameOf = (id: string) => zoneNames[id] ?? id;

  return (
    <>
      <div className={styles.cardBody}>
        <div className={styles.cardInner}>
          {notes.length > 0 ? <Alert tone="warning">{notes.join(' ')}</Alert> : null}
          <DescriptionList
            dense
            columns={2}
            items={[
              { label: m('bt.result'), value: res === null ? '-' : m(`bt.${res}`, { p: format.ratio(Math.abs(imp ?? 0), 1) }) },
              { label: m('bt.passBar'), value: m('bt.targetOn', { p: format.ratio(latest.gate.min_improvement, 0), base: m(latest.gate.baseline === 'segment' ? 'bt.base.segment' : 'bt.base.naive') }) },
              { label: m('bt.held'), value: span(latest.held_out.from, latest.held_out.to) },
              { label: m('bt.window'), value: span(latest.training.from, latest.training.to) },
              { label: m('bt.model'), value: <span translate="no">{latest.model_version}</span> },
              { label: m('bt.features'), value: latest.training.features == null ? '-' : m('bt.featuresVal', { n: latest.training.features }) },
              { label: m('r.input'), value: <DataSourceBadge sources={sourcesOf(latest)} /> },
            ]}
          />
        </div>
      </div>

      <Section title={m('bt.metrics')}>
        <DataTable pageSize={0} caption={m('bt.metrics')} columns={measureCols} rows={measures} getRowId={(row) => row.key} footer={rangeFooter} />
      </Section>

      {chall == null ? null : (
        <Section
          title={m('bt.chall', { model: chall.challenger })}
          extra={
            chall.gate_result == null ? null : (
              <span className={styles.inline}>
                {latest.illustrative ? <IllustrativeLabel /> : null}
                <StatusPill status={m(`bt.bar.${chall.gate_result}`)} tone={GATE_TONE[chall.gate_result]} size="sm" />
              </span>
            )
          }
        >
          {chall.error != null ? (
            <div className={styles.cardBody}>
              <p className={styles.empty}>{m('bt.challError')}</p>
            </div>
          ) : (
            <DataTable
              pageSize={0}
              caption={m('bt.chall', { model: chall.challenger })}
              rows={challRows}
              getRowId={(row) => row.key}
              columns={[
                {
                  key: 'measure',
                  header: m('bt.col.measure'),
                  cell: (row) => (
                    <Tooltip content={row.tip}>
                      <span className={styles.strong} translate="no" tabIndex={0}>
                        {row.name}
                      </span>
                    </Tooltip>
                  ),
                },
                { key: 'champion', header: m('bt.col.champion'), align: 'end', cell: (row) => <span translate="no">{format.ratio(row.champion, 1)}</span> },
                { key: 'challenger', header: m('bt.col.challenger'), align: 'end', cell: (row) => <b translate="no">{format.ratio(row.challenger, 1)}</b> },
                {
                  key: 'lift',
                  header: m('bt.col.lift'),
                  align: 'end',
                  cell: (row) => (
                    <bdi dir="ltr" translate="no">
                      {signed(row.lift)}
                    </bdi>
                  ),
                },
              ]}
            />
          )}
        </Section>
      )}

      <Section title={m('bt.split')}>
        <DataTable
          pageSize={0}
          caption={m('bt.split')}
          rows={dayRows}
          getRowId={(row) => row.key}
          columns={[
            {
              key: 'type',
              header: m('bt.col.daytype'),
              cell: (row) => (
                <span className={styles.stackTight}>
                  <span className={styles.strong}>{row.name}</span>
                  <span className={styles.meta}>{row.sub}</span>
                </span>
              ),
            },
            { key: 'wape', header: WAPE, align: 'end', cell: (row) => (row.d.days === 0 ? <span className={styles.meta}>{m('bt.fewDays')}</span> : <b translate="no">{format.ratio(row.d.wape, 1)}</b>) },
            { key: 'base', header: m('bt.col.baseline'), align: 'end', cell: (row) => (row.d.days === 0 ? '-' : <span translate="no">{format.ratio(row.d.baseline_wape, 1)}</span>) },
            { key: 'days', header: m('bt.col.days'), align: 'end', cell: (row) => <span translate="no">{format.int(row.d.days)}</span> },
          ]}
        />
      </Section>

      {latest.weakest_zones.length === 0 ? null : (
        <Section title={m('bt.weakest')}>
          <DataTable
            pageSize={0}
            caption={m('bt.weakest')}
            rows={[...zones]}
            getRowId={(row) => row.zone_id}
            rowLabel={(row) => nameOf(row.zone_id)}
            rowTone={(row) => (row.wape != null && row.baseline_wape != null && row.wape > row.baseline_wape ? 'warning' : undefined)}
            columns={[
              {
                key: 'zone',
                header: t('common.zone'),
                cell: (row) => {
                  const worse = row.wape != null && row.baseline_wape != null && row.wape > row.baseline_wape;
                  return (
                    <span className={styles.stackTight}>
                      <bdi className={styles.strong} translate="no">
                        {nameOf(row.zone_id)}
                      </bdi>
                      {worse ? <span className={styles.meta}>{m('bt.worseThanBase')}</span> : row.actual_total < FEW_CASES ? <span className={styles.meta}>{m('bt.fewCasesShort')}</span> : null}
                    </span>
                  );
                },
              },
              { key: 'wape', header: WAPE, align: 'end', cell: (row) => <b translate="no">{format.ratio(row.wape, 1)}</b> },
              { key: 'base', header: m('bt.col.baselineWape'), align: 'end', hideBelow: 'md', cell: (row) => <span translate="no">{format.ratio(row.baseline_wape, 1)}</span> },
              { key: 'cases', header: m('bt.col.cases'), align: 'end', hideBelow: 'md', cell: (row) => <span translate="no">{format.int(row.actual_total)}</span> },
              {
                key: 'open',
                header: <span className={styles.srOnly}>{m('bt.col.open')}</span>,
                align: 'end',
                cell: (row) => (
                  <Button variant="ghost" size="sm" aria-label={`${m('bt.hourly')}: ${nameOf(row.zone_id)}`} onClick={() => setOpen(row)}>
                    <ChevronRight aria-hidden="true" className={styles.flip} />
                  </Button>
                ),
              },
            ]}
          />
          {latest.weakest_zones.length > SHOWN ? (
            <div className={styles.btFoot}>
              <Button variant="link" size="sm" aria-expanded={all} endIcon={all ? <ChevronUp /> : <ChevronDown />} onClick={() => setAll(!all)}>
                {m(all ? 'bt.showFewer' : 'bt.showAll', { n: latest.weakest_zones.length })}
              </Button>
            </div>
          ) : null}
        </Section>
      )}
      <ZoneDrawer zone={open} name={open === null ? '' : nameOf(open.zone_id)} onClose={() => setOpen(null)} />
    </>
  );
}

function MapePill({ mape, target }: { mape: number | null | undefined; target: number | null }) {
  const m = useTranslations('admin.forecast_model');
  const format = useFormat();
  const status = mapeStatus(mape, target);
  if (status === null || target === null) return null;
  const ok = status === 'ok';
  return <StatusPill status={m(ok ? 'bt.mapeOk' : 'bt.mapeAbove', { p: format.ratio(target, 0) })} tone={ok ? 'success' : 'warning'} size="sm" />;
}

export function BacktestCard({ data, canEdit, mapeTarget = null }: { data: BacktestCardData; canEdit: boolean; mapeTarget?: number | null }) {
  const m = useTranslations('admin.forecast_model');
  const t = useTranslations();
  const router = useRouter();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const run = useAdminAction(startBacktest, { successTitle: m('bt.started'), successDescription: m('bt.startedDesc') });
  const state = data.state;
  const running = state?.run.state === 'running' || run.pending;

  useEffect(() => {
    if (state?.run.state !== 'running') return undefined;
    const timer = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [state?.run.state, router]);

  const reason = gate.edit.reason ?? (running ? m('bt.runningReason') : null);
  const runButton = (
    <ReasonHint reason={reason} visible={false}>
      <Button variant="secondary" size="sm" startIcon={<Play />} loading={run.pending} onClick={() => reason === null && run.run()}>
        {m('bt.run')}
      </Button>
    </ReasonHint>
  );
  const latest = state?.latest ?? null;
  const stale = state !== null && isStale(state);
  const failed = state?.run.state === 'failed' ? (state.run.error_class ?? 'unexpected') : null;
  const warn = failed === null ? [] : [m(latest === null ? 'bt.failedOnly' : 'bt.failedNote', { cls: failed })];

  let body: ReactNode;
  if (data.error) {
    body = (
      <EmptyState
        compact
        tone="danger"
        title={m('bt.error')}
        action={
          <Button variant="secondary" size="sm" startIcon={<RefreshCw />} onClick={() => router.refresh()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  } else if (running) {
    body = (
      <div className={styles.cardBody} aria-busy="true">
        <SkeletonText lines={5} announce />
      </div>
    );
  } else if (latest === null) {
    body = (
      <>
        {warn.length > 0 ? (
          <div className={styles.cardBody}>
            <Alert tone="warning">{warn[0]}</Alert>
          </div>
        ) : null}
        <EmptyState compact icon={<ChartLine />} title={m('bt.empty.title')} description={m('bt.empty.desc')} action={runButton} />
      </>
    );
  } else {
    body = <Filled latest={latest} zoneNames={data.zoneNames} stale={stale} activeModel={state?.active_model ?? ''} warn={warn} />;
  }

  return (
    <Card padding="none">
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{m('bt.title')}</h2>
        <div className={styles.inline}>
          {latest === null || latest.illustrative ? <IllustrativeLabel /> : null}
          {running ? <StatusPill status={m('bt.running')} tone="info" size="sm" /> : null}
          {!running && latest !== null && !data.error ? <StatusPill status={m(`bt.bar.${latest.gate.result}`)} tone={GATE_TONE[latest.gate.result]} size="sm" /> : null}
          {!running && latest !== null && !data.error ? <MapePill mape={latest.engine.mape} target={mapeTarget} /> : null}
          {!running && stale ? <StatusPill status={m('bt.stale')} tone="warning" size="sm" /> : null}
          {data.error || (!running && latest === null) ? null : runButton}
        </div>
      </div>
      {run.error === null ? null : (
        <div className={styles.cardBody}>
          <ActionError error={run.error} onDismiss={run.reset} />
        </div>
      )}
      {body}
    </Card>
  );
}
