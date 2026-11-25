// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Invariants of the engine payloads that JSON Schema cannot express. The schemas document them;
 * this module checks them. Used by validate-contracts and available to fixture validators.
 *
 *   checkEngineInvariants(name, document, options?): string[]
 *       name is an engine schema name such as "forecaster.output". Returns human-readable
 *       problems (empty array means the document satisfies every invariant). Only the four
 *       *.output schemas have invariants; other names return [].
 *       options.complete (default false): for forecaster.output, also require every
 *       (zone_id, sub_zone_id) pair to have exactly horizon.days x 96 values.
 */

type Rec = Record<string, unknown>;

const EPS = 1e-9;
const SPLIT_TOLERANCE = 0.01;

function asArray(value: unknown): Rec[] {
  return Array.isArray(value) ? (value as Rec[]) : [];
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

/** Quarter-hour slot (0 to 95) of the wall-clock time in an ISO 8601 string, or undefined. */
export function quarterHourSlot(iso: unknown): number | undefined {
  if (typeof iso !== 'string') return undefined;
  const match = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (minute % 15 !== 0 || second !== 0) return undefined;
  return hour * 4 + minute / 15;
}

function forecaster(doc: Rec, complete: boolean): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const perPair = new Map<string, number>();
  asArray(doc['values']).forEach((v, i) => {
    const at = `values[${i}]`;
    const low = num(v['low']);
    const expected = num(v['expected']);
    const high = num(v['high']);
    if (!(low <= expected + EPS && expected <= high + EPS)) {
      problems.push(`${at}: low <= expected <= high violated (${low}, ${expected}, ${high})`);
    }
    const split = num(v['field_expected']) + num(v['remote_inferred_expected']);
    if (!(Math.abs(split - expected) <= SPLIT_TOLERANCE)) {
      problems.push(`${at}: field_expected + remote_inferred_expected (${split}) differs from expected (${expected})`);
    }
    const slot = quarterHourSlot(v['interval_start']);
    if (slot === undefined) problems.push(`${at}: interval_start is not aligned to the quarter hour`);
    else if (slot !== v['interval_index']) {
      problems.push(`${at}: interval_index ${String(v['interval_index'])} does not match interval_start slot ${slot}`);
    }
    const key = `${String(v['zone_id'])}|${String(v['sub_zone_id'])}|${String(v['interval_start'])}`;
    if (seen.has(key)) problems.push(`${at}: duplicate (zone, sub-zone, interval)`);
    seen.add(key);
    const pair = `${String(v['zone_id'])}|${String(v['sub_zone_id'])}`;
    perPair.set(pair, (perPair.get(pair) ?? 0) + 1);
  });
  if (complete) {
    const days = num((doc['horizon'] as Rec | undefined)?.['days']);
    for (const [pair, count] of perPair) {
      if (count !== days * 96) problems.push(`pair ${pair}: ${count} values, expected ${days * 96} (${days} days x 96)`);
    }
  }
  return problems;
}

function optimizer(doc: Rec): string[] {
  const problems: string[] = [];
  asArray(doc['gap_cells']).forEach((cell, i) => {
    const at = `gap_cells[${i}]`;
    const delta = num(cell['delta']);
    const kind = cell['kind'];
    const expectedKind = delta < 0 ? 'gap' : delta > 0 ? 'surplus' : 'balanced';
    if (kind !== expectedKind) problems.push(`${at}: kind ${String(kind)} does not match delta ${delta}`);
    if (Math.abs(num(cell['planned']) - num(cell['required']) - delta) > EPS) {
      problems.push(`${at}: delta is not planned - required`);
    }
    if (kind === 'balanced' && cell['cause'] !== null) problems.push(`${at}: balanced cell must have cause null`);
    if (kind !== 'balanced' && cell['cause'] === null) problems.push(`${at}: gap or surplus cell needs a cause`);
    const slot = quarterHourSlot(cell['interval_start']);
    if (slot === undefined || slot !== cell['interval_index']) {
      problems.push(`${at}: interval_index does not match interval_start`);
    }
  });
  const seen = new Set<string>();
  asArray(doc['roster_assignments']).forEach((a, i) => {
    const key = `${String(a['agent_id'])}|${String(a['shift_pattern_id'])}|${String(a['roster_date'])}`;
    if (seen.has(key)) problems.push(`roster_assignments[${i}]: agent appears twice on the same shift and date`);
    seen.add(key);
  });
  return problems;
}

function readingProblems(reading: unknown, at: string): string[] {
  const r = (reading ?? {}) as Rec;
  const within = num(r['within_count']);
  const count = num(r['case_count']);
  const share = r['share'];
  const problems: string[] = [];
  if (within > count) problems.push(`${at}: within_count exceeds case_count`);
  if (count === 0 && share !== null) problems.push(`${at}: share must be null when case_count is 0`);
  if (count > 0 && (typeof share !== 'number' || Math.abs(share - within / count) > 1e-6)) {
    problems.push(`${at}: share is not within_count / case_count`);
  }
  return problems;
}

function serviceLevelProblems(sl: unknown, at: string): string[] {
  const s = (sl ?? {}) as Rec;
  return [
    ...readingProblems(s['from_registration'], `${at}.from_registration`),
    ...readingProblems(s['from_assignment'], `${at}.from_assignment`),
  ];
}

function simulator(doc: Rec): string[] {
  const problems = serviceLevelProblems(doc['overall'], 'overall');
  asArray(doc['zones']).forEach((z, i) => problems.push(...serviceLevelProblems(z['service_level'], `zones[${i}]`)));
  asArray(doc['intervals']).forEach((z, i) => problems.push(...serviceLevelProblems(z['service_level'], `intervals[${i}]`)));
  return problems;
}

function assignment(doc: Rec): string[] {
  const problems: string[] = [];
  const ranking = asArray(doc['ranking']);
  const status = doc['status'];
  if (status === 'ranked' && ranking.length === 0) problems.push('status ranked needs at least one ranking entry');
  if (status !== 'ranked' && ranking.length > 0) problems.push(`status ${String(status)} must have an empty ranking`);
  ranking.forEach((r, i) => {
    if (r['rank'] !== i + 1) problems.push(`ranking[${i}]: rank must be ${i + 1} (ranks start at 1 with no gaps)`);
  });
  const ids = ranking.map((r) => String(r['agent_id']));
  if (new Set(ids).size !== ids.length) problems.push('ranking lists an agent twice');
  return problems;
}

export function checkEngineInvariants(name: string, document: unknown, options: { complete?: boolean } = {}): string[] {
  const doc = (document ?? {}) as Rec;
  switch (name.replace(/\.schema(\.json)?$/, '')) {
    case 'forecaster.output':
      return forecaster(doc, options.complete ?? false);
    case 'optimizer.output':
      return optimizer(doc);
    case 'simulator.output':
      return simulator(doc);
    case 'assignment.output':
      return assignment(doc);
    default:
      return [];
  }
}
