// SPDX-License-Identifier: AGPL-3.0-only
// Calibration check: recomputes every numeric target from the committed fixtures and prints
// target | actual | tolerance | PASS/FAIL. Exits non-zero on any FAIL. The assumption rows (daily shape, busiest days,
// Ramadan) are checked by eye: this script also writes hand-written SVG charts to docs/calibration/.
//
//   pnpm calibration:check               table, plus the daily-shape and weekday charts
//   pnpm calibration:check --ramadan     also the Ramadan-profile chart (from the generator's profile; fixtures untouched)
//   pnpm calibration:check --no-charts   table only

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibration } from './gen/calibration';
import { prayerTimesFor } from './gen/calendar';
import { chartSvg } from './gen/charts';
import { baseSlotLevels, dayMultiplier, ramadanSlotWeights, slotWeights } from './gen/demand';
import { percentile } from './gen/dist';
import { parseIso, slotLabel, weekdayOf } from './gen/time';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

type Row = Record<string, unknown>;

interface Tolerance {
  readonly kind: 'points' | 'relative' | 'ceiling' | 'exact';
  readonly value?: number;
}

export interface CheckRow {
  readonly name: string;
  readonly target: string;
  readonly actual: string;
  readonly tolerance: string;
  readonly pass: boolean;
  readonly source: string;
}

export interface CheckResult {
  readonly rows: CheckRow[];
  readonly extras: CheckRow[];
  readonly caseTypeMix: { name: string; share: number; count: number }[];
  readonly slotAverages: number[];
  readonly perDay: { date: string; count: number }[];
  readonly totalCases: number;
  readonly fieldCases: number;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function loadArrays(fixturesDir: string, schema: string): Row[] {
  const manifest = readJson(path.join(fixturesDir, 'manifest.json')) as { files: { path: string; schema: string; kind: string }[] };
  const out: Row[] = [];
  for (const e of manifest.files) {
    if (e.schema !== schema || e.kind !== 'array') continue;
    out.push(...(readJson(path.join(fixturesDir, e.path)) as Row[]));
  }
  return out;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function judge(actual: number, target: number, tol: Tolerance): { pass: boolean; text: string } {
  switch (tol.kind) {
    case 'points': {
      const diff = Math.abs(actual - target) * 100;
      return { pass: diff <= (tol.value as number) + 1e-9, text: `+/-${tol.value} points (off by ${diff.toFixed(2)})` };
    }
    case 'relative': {
      const diff = Math.abs(actual - target) / target;
      return { pass: diff <= (tol.value as number) + 1e-9, text: `+/-${((tol.value as number) * 100).toFixed(0)}% (off by ${(diff * 100).toFixed(1)}%)` };
    }
    case 'ceiling':
      return { pass: actual < target, text: 'below the ceiling' };
    case 'exact':
      return { pass: actual === target, text: 'exact' };
  }
}

export function computeCheck(fixturesDir = path.join(repoRoot, 'fixtures')): CheckResult {
  const cases = loadArrays(fixturesDir, 'Case');
  const cities = loadArrays(fixturesDir, 'City');
  const zones = loadArrays(fixturesDir, 'Zone');
  const subZones = loadArrays(fixturesDir, 'SubZone');
  const caseTypes = loadArrays(fixturesDir, 'CaseType');
  const t = calibration.targets;
  const rows: CheckRow[] = [];
  const extras: CheckRow[] = [];

  const add = (list: CheckRow[], name: string, target: number, actual: number, tol: Tolerance, source: string, fmt: (x: number) => string): void => {
    const j = judge(actual, target, tol);
    list.push({ name, target: fmt(target), actual: fmt(actual), tolerance: j.text, pass: j.pass, source });
  };
  const fixed = (d: number) => (x: number): string => x.toFixed(d);
  const tolOf = (o: { tolerance: { kind: string; value?: number } }): Tolerance => o.tolerance as Tolerance;

  const total = cases.length;
  const field = cases.filter((c) => c['handling'] === 'field');
  const remote = cases.filter((c) => c['handling'] !== 'field');
  const secs = (v: unknown): number => parseIso(String(v));

  // 1. Remote share
  add(rows, 'Share with no agent sent (remote)', t.remote_share.value, remote.length / total, tolOf(t.remote_share), t.remote_share.source, pct);

  // 2-4. Timings on field cases (all of them, including the few assigned before registration)
  const d1 = field.map((c) => (secs(c['assigned_at']) - secs(c['registered_at'])) / 60).sort((a, b) => a - b);
  const d2 = field.map((c) => (secs(c['arrived_at']) - secs(c['assigned_at'])) / 60).sort((a, b) => a - b);
  const d3 = field.map((c) => (secs(c['closed_at']) - secs(c['arrived_at'])) / 60).sort((a, b) => a - b);
  add(rows, 'Registered to assigned, median (min)', t.registered_to_assigned_median_min.value, percentile(d1, 50), tolOf(t.registered_to_assigned_median_min), t.registered_to_assigned_median_min.source, fixed(2));
  add(rows, 'Registered to assigned, 90th pct (min)', t.registered_to_assigned_p90_min.value, percentile(d1, 90), tolOf(t.registered_to_assigned_p90_min), t.registered_to_assigned_p90_min.source, fixed(2));
  add(rows, 'Assigned to arrived, median (min)', t.assigned_to_arrived_median_min.value, percentile(d2, 50), tolOf(t.assigned_to_arrived_median_min), t.assigned_to_arrived_median_min.source, fixed(2));
  add(rows, 'Assigned to arrived, 90th pct (min)', t.assigned_to_arrived_p90_min.value, percentile(d2, 90), tolOf(t.assigned_to_arrived_p90_min), t.assigned_to_arrived_p90_min.source, fixed(2));
  add(rows, 'Arrived to closed, median (min)', t.arrived_to_closed_median_min.value, percentile(d3, 50), tolOf(t.arrived_to_closed_median_min), t.arrived_to_closed_median_min.source, fixed(2));

  // 5-6. Shape
  const slotTotals = new Array<number>(96).fill(0);
  const hourTotals = new Array<number>(24).fill(0);
  const dayCounts = new Map<string, number>();
  for (const c of cases) {
    const s = String(c['registered_at']);
    const hour = Number(s.slice(11, 13));
    const minute = Number(s.slice(14, 16));
    slotTotals[hour * 4 + Math.floor(minute / 15)] = (slotTotals[hour * 4 + Math.floor(minute / 15)] as number) + 1;
    hourTotals[hour] = (hourTotals[hour] as number) + 1;
    dayCounts.set(s.slice(0, 10), (dayCounts.get(s.slice(0, 10)) ?? 0) + 1);
  }
  add(rows, 'Late night: 00:00 hour vs 06:00 hour', t.late_night_ratio.value, (hourTotals[0] as number) / (hourTotals[6] as number), tolOf(t.late_night_ratio), t.late_night_ratio.source, fixed(3));
  add(rows, 'Morning ramp: 07:00 slot vs 06:00 slot', t.morning_ramp_ratio.value, (slotTotals[28] as number) / (slotTotals[24] as number), tolOf(t.morning_ramp_ratio), t.morning_ramp_ratio.source, fixed(2));

  // 7-9. Parties
  const share = (pred: (n: number) => boolean): number => cases.filter((c) => pred(Number(c['parties_involved']))).length / total;
  add(rows, 'Parties: two', t.parties_two_share.value, share((n) => n === 2), tolOf(t.parties_two_share), t.parties_two_share.source, pct);
  add(rows, 'Parties: three or more', t.parties_three_or_more_share.value, share((n) => n >= 3), tolOf(t.parties_three_or_more_share), t.parties_three_or_more_share.source, pct);
  add(rows, 'Parties: zero or one (under)', t.parties_zero_or_one_share_max.value, share((n) => n <= 1), tolOf(t.parties_zero_or_one_share_max), t.parties_zero_or_one_share_max.source, pct);

  // 10-12. Handling by case type
  const typeName = new Map<string, string>(caseTypes.map((c) => [String(c['id']), String(c['name_en'])]));
  const fieldShareOf = (name: string): number => {
    const of = cases.filter((c) => typeName.get(String(c['case_type_id'])) === name);
    return of.filter((c) => c['handling'] === 'field').length / of.length;
  };
  add(rows, 'Field share: Unlisted', t.field_share_unlisted.value, fieldShareOf('Unlisted'), tolOf(t.field_share_unlisted), t.field_share_unlisted.source, pct);
  add(rows, 'Field share: Police attended', t.field_share_customer_and_police.value, fieldShareOf('Police attended'), tolOf(t.field_share_customer_and_police), t.field_share_customer_and_police.source, pct);
  add(rows, 'Field share: Standard case', t.field_share_customer.value, fieldShareOf('Standard case'), tolOf(t.field_share_customer), t.field_share_customer.source, pct);

  // 13-15. City shares
  const cityCode = new Map<string, string>(cities.map((c) => [String(c['id']), String(c['case_code'])]));
  const cityShare = (code: string): number => cases.filter((c) => cityCode.get(String(c['city_id'])) === code).length / total;
  add(rows, 'City share: Riyadh', t.city_share_riyadh.value, cityShare('RD'), tolOf(t.city_share_riyadh), t.city_share_riyadh.source, pct);
  add(rows, 'City share: Jeddah', t.city_share_jeddah.value, cityShare('JD'), tolOf(t.city_share_jeddah), t.city_share_jeddah.source, pct);
  add(rows, 'City share: Dammam', t.city_share_dammam.value, cityShare('DM'), tolOf(t.city_share_dammam), t.city_share_dammam.source, pct);

  // 16. Zones and sub-zones
  const wantZones = t.zones_in_fixtures.value as Record<string, number>;
  for (const [code, want] of Object.entries(wantZones)) {
    const city = cities.find((c) => c['case_code'] === code);
    const have = zones.filter((z) => z['city_id'] === city?.['id']).length;
    add(rows, `Zones in ${code}`, want, have, { kind: 'exact' }, t.zones_in_fixtures.source, fixed(0));
  }
  const subCounts = zones.map((z) => subZones.filter((s) => s['zone_id'] === z['id']).length);
  const lo = Math.min(...subCounts);
  const hi = Math.max(...subCounts);
  const cfg = calibration.structure.sub_zones_per_zone;
  rows.push({ name: 'Sub-zones per zone (range)', target: `${cfg.min} to ${cfg.max}`, actual: `${lo} to ${hi}`, tolerance: 'inside the range', pass: lo >= cfg.min && hi <= cfg.max, source: 'Imported sample, 1 Sep 2026' });

  // Extra figures, held to the same tolerances
  const ex = t.extra_figures;
  add(extras, 'Arrived within 10 min of assignment', ex.within_10_min_of_assignment.value, field.filter((c) => secs(c['arrived_at']) - secs(c['assigned_at']) <= 600).length / field.length, tolOf(ex.within_10_min_of_assignment), ex.within_10_min_of_assignment.source, pct);
  add(extras, 'Arrived within 10 min of registration', ex.within_10_min_of_registration.value, field.filter((c) => secs(c['arrived_at']) - secs(c['registered_at']) <= 600).length / field.length, tolOf(ex.within_10_min_of_registration), ex.within_10_min_of_registration.source, pct);
  const unlistedField = field.filter((c) => typeName.get(String(c['case_type_id'])) === 'Unlisted');
  add(extras, 'Unlisted field cases assigned before registration', ex.unlisted_assigned_before_registration_share.value, unlistedField.filter((c) => secs(c['assigned_at']) < secs(c['registered_at'])).length / unlistedField.length, tolOf(ex.unlisted_assigned_before_registration_share), ex.unlisted_assigned_before_registration_share.source, pct);
  add(extras, 'Parties: exactly three', ex.parties_three_share.value, share((n) => n === 3), tolOf(ex.parties_three_share), ex.parties_three_share.source, pct);
  add(extras, 'Parties: four or more', ex.parties_four_or_more_share.value, share((n) => n >= 4), tolOf(ex.parties_four_or_more_share), ex.parties_four_or_more_share.source, pct);
  const mixTarget = ex.case_type_mix.value as Record<string, number>;
  const caseTypeMix = Object.keys(mixTarget).map((name) => {
    const count = cases.filter((c) => typeName.get(String(c['case_type_id'])) === name).length;
    return { name, share: count / total, count };
  });
  for (const m of caseTypeMix) add(extras, `Case-type mix: ${m.name}`, mixTarget[m.name] as number, m.share, tolOf(ex.case_type_mix), ex.case_type_mix.source, pct);

  const days = [...dayCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const days7 = Math.max(1, days.length);
  return {
    rows,
    extras,
    caseTypeMix,
    slotAverages: slotTotals.map((n) => n / days7),
    perDay: days.map(([date, count]) => ({ date, count })),
    totalCases: total,
    fieldCases: field.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------------

function printTable(title: string, rows: readonly CheckRow[]): void {
  const cols = ['Target', 'Wanted', 'Actual', 'Tolerance', 'Result'] as const;
  const cells = rows.map((r) => [r.name, r.target, r.actual, r.tolerance, r.pass ? 'PASS' : 'FAIL']);
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((row) => (row[i] as string).length)));
  const line = (row: readonly string[]): string => row.map((c, i) => c.padEnd(widths[i] as number)).join('  ');
  console.log(`\n${title}`);
  console.log(line([...cols]));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of cells) console.log(line(row));
}

export function writeCharts(result: CheckResult, outDir: string, options: { ramadan: boolean }): string[] {
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const put = (name: string, svg: string): void => {
    const p = path.join(outDir, name);
    fs.writeFileSync(p, svg, 'utf8');
    written.push(p);
  };
  const labels = Array.from({ length: 96 }, (_, i) => slotLabel(i));
  const perDayTotal = result.totalCases / Math.max(1, result.perDay.length);
  const expected = slotWeights().map((w) => w * perDayTotal);
  put(
    'daily-shape.svg',
    chartSvg({
      title: 'Cases by 15-minute slot, average of the case week',
      subtitle: `Bars: the fixtures (${result.totalCases.toLocaleString('en-US')} cases over ${result.perDay.length} days). Line: the calibration shape. Check by eye: afternoon peak, evening shoulder, taper after 22:00, sharp rise from 06:30.`,
      description: 'Average number of cases registered in each 15-minute slot of the day, from the synthetic fixtures, with the calibration shape drawn over it.',
      categories: labels,
      series: [
        { label: 'Fixtures, cases per slot per day', values: result.slotAverages, kind: 'bars', color: '#5b8fb9' },
        { label: 'Calibration shape', values: expected, kind: 'line', color: '#c2410c' },
      ],
      yLabel: 'cases per 15 minutes',
      labelEvery: 8,
    }),
  );
  const weekdayCounts = result.perDay.map((d) => ({ name: weekdayOf(d.date), count: d.count }));
  const mean = result.totalCases / Math.max(1, result.perDay.length);
  put(
    'cases-per-weekday.svg',
    chartSvg({
      title: 'Cases per day, Sunday 6 to Saturday 12 September 2026',
      subtitle: 'Bars: the fixtures. Line: cases per day times the weekday multiplier. Check by eye: Wednesday, Thursday and Friday higher, Sunday lowest.',
      description: 'Number of cases per weekday in the synthetic fixtures, with the calibration multipliers drawn over it.',
      categories: weekdayCounts.map((d) => d.name),
      series: [
        { label: 'Fixtures, cases per day', values: weekdayCounts.map((d) => d.count), kind: 'bars', color: '#5b8fb9' },
        { label: 'Calibration: mean x multiplier', values: result.perDay.map((d) => mean * dayMultiplier(d.date)), kind: 'line', color: '#c2410c' },
      ],
      yLabel: 'cases per day',
      labelEvery: 1,
      width: 720,
    }),
  );
  if (options.ramadan) put('ramadan-profile.svg', ramadanChart());
  return written;
}

/** The Ramadan demand profile of calibration.json for one sample day, drawn against the normal shape. Not from fixtures. */
export function ramadanChart(): string {
  const profile = calibration.demand.ramadan_profile.value;
  const city = calibration.locations.cities[0] as { anchor: { lat: number; lng: number } };
  const p = prayerTimesFor({ anchor: city.anchor }, profile.sample_date);
  const secOfDay = (epoch: number): number => (((epoch + 3 * 3600) % 86400) + 86400) % 86400;
  const fajr = secOfDay(p.fajr);
  const maghrib = secOfDay(p.maghrib);
  const perDay = calibration.structure.cases_per_day.value;
  const ramadan = ramadanSlotWeights({ fajr, maghrib }).map((w) => w * perDay);
  const normal = baseSlotLevels();
  const sum = normal.reduce((a, b) => a + b, 0);
  const normalCases = normal.map((l) => (l / sum) * perDay);
  const labels = Array.from({ length: 96 }, (_, i) => slotLabel(i));
  const fajrSlot = fajr / 900 - 0.5;
  const maghribSlot = maghrib / 900 - 0.5;
  return chartSvg({
    title: `Ramadan demand profile, sample day ${profile.sample_date} (Riyadh prayer times)`,
    subtitle: 'Bars: Ramadan profile. Line: the normal shape at the same total. Check by eye: spike in the hour before fajr and before iftar, quieter midday.',
    description: 'Expected cases per 15-minute slot on a Ramadan day, from the generator profile, against the normal day shape.',
    categories: labels,
    series: [
      { label: 'Ramadan profile', values: ramadan, kind: 'bars', color: '#5b8fb9' },
      { label: 'Normal day shape', values: normalCases, kind: 'line', color: '#c2410c' },
    ],
    yLabel: 'expected cases per 15 minutes',
    labelEvery: 8,
    markers: [
      { at: fajrSlot, label: 'fajr' },
      { at: maghribSlot, label: 'iftar (maghrib)' },
    ],
  });
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const result = computeCheck();
  printTable('Targets from (recomputed from fixtures/)', result.rows);
  printTable('Extra figures', result.extras);
  console.log(`\nCases: ${result.totalCases.toLocaleString('en-US')} over ${result.perDay.length} days; field ${result.fieldCases.toLocaleString('en-US')} (${pct(result.fieldCases / result.totalCases)}).`);
  console.log('Case-type mix: ' + result.caseTypeMix.map((m) => `${m.name} ${pct(m.share)} (${m.count.toLocaleString('en-US')})`).join(', '));
  console.log('Cases per day: ' + result.perDay.map((d) => `${weekdayOf(d.date).slice(0, 3)} ${d.count.toLocaleString('en-US')}`).join(', '));
  if (!argv.includes('--no-charts')) {
    const written = writeCharts(result, path.join(repoRoot, 'docs', 'calibration'), { ramadan: argv.includes('--ramadan') });
    console.log('\nCharts for the by-eye rows (daily shape, busiest days' + (argv.includes('--ramadan') ? ', Ramadan' : '') + '):');
    for (const w of written) console.log(`  ${path.relative(repoRoot, w)}`);
  }
  const all = [...result.rows, ...result.extras];
  const failed = all.filter((r) => !r.pass);
  console.log(failed.length === 0 ? `\nAll ${all.length} numeric checks PASS.` : `\n${failed.length} of ${all.length} numeric checks FAIL: ${failed.map((r) => r.name).join('; ')}`);
  console.log('Figures come from synthetic data and are Illustrative, not measured.');
  return failed.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
