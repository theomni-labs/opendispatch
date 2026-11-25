// SPDX-License-Identifier: AGPL-3.0-only
// Live Dispatch Board view

import { date, dateBoth, time } from '@opendispatch/ui/format';
import { addDays } from '@/lib/day';
import { dateOf, epochOf } from '@/lib/data/context';
import { getCaseRecommendation, getLiveBoard, getShadowComparisonSummary, listShadowComparisons, listAgentStatuses, listUnmetDemand, listWaitingSpots } from '@/lib/data/dispatch';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { listCases } from '@/lib/data/cases';
import { countUnreadNotifications } from '@/lib/data/notifications';
import { listAgents } from '@/lib/data/people';
import { getSettingsSnapshot } from '@/lib/data/settings';
import type { AssignmentComparison, LiveCase, LiveStage, PageInfo, Agent, AgentLiveStatus, AgentStatus, UnmetDemandCase, WaitingSpots, Zone } from '@/lib/types';
import type { CaseClassification, CaseEta, CasePick, CaseReason, CaseSourceDisplay } from '@/components/opendispatch/LiveCaseCard';
import type { ShadowComparisonRow } from '@/components/opendispatch/ShadowComparisonList';
import type { BoardColumn, CaseCardView, LiveDispatchView, OverrideOption, UnmetRowView } from './types';
import { spotMarks, waitingSpotsView } from './waiting';
import { BOARD_COLUMNS } from './types';
import { DEFAULT_THRESHOLD_SECONDS, type UnmetCause } from './unmet';

const PAGE = 200;
const OVERRIDE_ALTERNATIVES = 6;
const COMPARISON_ROWS = 8;
const CASE_IDS_PER_CALL = 200;
const OPTION_CALLS = 8;
const LEGEND_STATUSES = ['available', 'en_route', 'on_scene'] as const satisfies readonly AgentLiveStatus[];

/** Every page of a list read, oldest cursor first (the agent roster runs to 330: one page is not enough). */
async function everyPage<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

// fn over items, `limit` at once, in order
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// One listCases per 200 ids; unreadable left out
async function caseNumbersOf(ctx: RequestContext, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += CASE_IDS_PER_CALL) {
    const page = await listCases(ctx, { ids: unique.slice(i, i + CASE_IDS_PER_CALL), limit: CASE_IDS_PER_CALL });
    for (const c of page.items) out.set(c.id, c.case_number);
  }
  return out;
}

/** `extra.code` (RD-C); the name when a zone has none (the same rule admin/data_sources uses). */
function zoneCodeOf(zone: Zone | undefined): string {
  if (zone === undefined) return '—';
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
}

/** A pick's name; null when it is outside the reader's zones. */
function pickNameOf(agent: Agent | undefined): string | null {
  return agent?.name_en ?? null;
}

/** @pure Clock time; the date too when it is another day. */
export function clockOf(iso: string, sameDayAs: string, locale: string): string {
  return dateOf(iso) === dateOf(sameDayAs) ? time(iso) : `${date(iso, { locale })} ${time(iso)}`;
}

function agentNameOf(agent: Agent | undefined): string {
  return agent?.name_en ?? '—';
}

function minutesOf(seconds: number | null | undefined): number {
  return seconds === null || seconds === undefined ? 0 : Math.max(0, Math.round(seconds / 60));
}

/** Elapsed "HH:mm" since the start of the comparison's own day (the mockup's `00:10`), not a clock time. */
function elapsedHm(iso: string): string {
  const dayStartMs = epochOf(`${dateOf(iso)}T00:00:00+03:00`);
  const totalMinutes = Math.max(0, Math.round((epochOf(iso) - dayStartMs) / 60_000));
  return time(totalMinutes);
}

function resolvedColumn(status: AgentLiveStatus | undefined): BoardColumn {
  if (status === 'on_scene') return 'onscene';
  if (status === 'en_route') return 'enroute';
  return 'assigned';
}

function sourceDisplayOf(c: LiveCase): CaseSourceDisplay {
  if (c.state === 'fallback_assigned') return 'fallback';
  if (c.assignment_source === 'MANUAL') return 'manual';
  if (c.assignment_source === 'OPENDISPATCH') return 'opendispatch';
  return 'customer';
}

interface Lookups {
  readonly zoneById: ReadonlyMap<string, Zone>;
  readonly agentById: ReadonlyMap<string, Agent>;
  readonly statusByAgent: ReadonlyMap<string, AgentStatus>;
  readonly locale: string;
}

/** The rules' answer for a card: handling, and the rule's name in the page's language. */
/** @pure The AI suggestion in brief, if any. */
export function aiOf(c: Pick<LiveCase, 'ai_suggestion'>): CaseCardView['ai'] {
  const s = c.ai_suggestion;
  return s === undefined ? undefined : { handling: s.handling, pct: Math.round(s.confidence * 100) };
}

export function classificationOf(c: Pick<LiveCase, 'classification'>, locale: string): CaseClassification | undefined {
  const cls = c.classification;
  if (cls === undefined) return undefined;
  const ar = cls.rule_name_ar ?? null;
  const name = locale === 'ar' && ar !== null && ar.trim() !== '' ? ar : (cls.rule_name_en ?? cls.rule_code ?? null);
  return { handling: cls.handling === 'remote_inferred' ? 'remote' : 'field', rule: cls.rule_code === null ? null : name, source: cls.source };
}

function cardOf(c: LiveCase, lookups: Lookups, nowMs: number): { column: BoardColumn; card: CaseCardView } {
  const zoneCode = zoneCodeOf(lookups.zoneById.get(c.zone_id));
  const registeredTime = time(c.registered_at);
  const reco = c.recommendation ?? null;
  const classification = classificationOf(c, lookups.locale);
  const recoName = reco === null ? undefined : agentNameOf(lookups.agentById.get(reco.agent_id));
  const recoPick = reco === null ? null : pickNameOf(lookups.agentById.get(reco.agent_id));

  if (c.state === 'waiting') {
    const pick: CasePick | undefined = reco === null ? undefined : { name: recoPick, label: 'opendispatch_would_pick' };
    const eta: CaseEta | undefined = reco === null ? undefined : { kind: 'travel', minutes: minutesOf(reco.estimated_travel_seconds) };
    const reason: CaseReason = { kind: 'waiting_customer' };
    const waitMinutes = Math.max(0, Math.round((nowMs - epochOf(c.registered_at)) / 60_000));
    return { column: 'waiting', card: { caseId: c.case_id, caseNumber: c.case_number, zoneCode, time: registeredTime, parties: c.parties_involved ?? 0, stage: c.stage, waitMinutes, pick, eta, reason, classification, ai: aiOf(c), canDecide: false } };
  }

  if (c.state === 'recommended') {
    const pick: CasePick | undefined = reco === null ? undefined : { name: recoPick, label: 'opendispatch_pick' };
    const eta: CaseEta | undefined = reco === null ? undefined : { kind: 'eta', time: clockOf(reco.estimated_arrival_at, c.registered_at, lookups.locale) };
    return {
      column: 'recommended',
      card: { caseId: c.case_id, caseNumber: c.case_number, zoneCode, time: registeredTime, parties: c.parties_involved ?? 0, stage: c.stage, pick, eta, classification, ai: aiOf(c), canDecide: true, recommendedAgentId: reco?.agent_id },
    };
  }

  // A decision was made; column follows live status.
  const source = sourceDisplayOf(c);
  const agentId = c.assigned_agent_id ?? undefined;
  const status = agentId === undefined ? undefined : lookups.statusByAgent.get(agentId)?.status;
  const column = resolvedColumn(status);
  const pick: CasePick = { name: pickNameOf(agentId === undefined ? undefined : lookups.agentById.get(agentId)), source };
  const eta: CaseEta | undefined =
    c.estimated_arrival_at === null || c.estimated_arrival_at === undefined
      ? undefined
      : { kind: column === 'onscene' ? 'arrived' : 'eta', time: clockOf(c.estimated_arrival_at, c.registered_at, lookups.locale) };
  const differs = reco !== null && recoName !== undefined && reco.agent_id !== agentId;
  const reason: CaseReason | undefined =
    c.state === 'overridden' && differs
      ? { kind: 'reassigned_from', name: recoName as string }
      : source !== 'opendispatch' && differs
        ? { kind: 'would_pick', name: recoName as string, minutes: minutesOf(reco?.estimated_travel_seconds) }
        : undefined;
  return { column, card: { caseId: c.case_id, caseNumber: c.case_number, zoneCode, time: registeredTime, parties: c.parties_involved ?? 0, stage: c.stage, pick, eta, reason, classification, ai: aiOf(c), canDecide: false } };
}

type EngineOutput = Awaited<ReturnType<typeof getCaseRecommendation>>;

function overrideOptionsOf(output: EngineOutput, c: LiveCase, lookups: Lookups): OverrideOption[] {
  if (output.status !== 'ranked') return [];
  const topId = c.recommendation?.agent_id;
  return output.ranking
    .filter((r) => r.agent_id !== topId)
    .slice(0, OVERRIDE_ALTERNATIVES)
    .map((r) => ({ agentId: r.agent_id, name: agentNameOf(lookups.agentById.get(r.agent_id)), minutes: minutesOf(r.estimated_travel_seconds) }));
}

function emptyColumns(): Record<BoardColumn, CaseCardView[]> {
  return { waiting: [], recommended: [], assigned: [], enroute: [], onscene: [] };
}

function mapView(board: Awaited<ReturnType<typeof getLiveBoard>>, lookups: Lookups, statuses: readonly AgentStatus[], spots: WaitingSpots['items']) {
  // One case count per zone, at its centre
  const perZone = new Map<string, number>();
  for (const c of board.cases) perZone.set(c.zone_id, (perZone.get(c.zone_id) ?? 0) + 1);
  const placed = board.stages.flatMap((stage) => {
    const zone = lookups.zoneById.get(stage.zone_id);
    if (zone === undefined || zone.latitude === undefined || zone.longitude === undefined) return [];
    return [{ stage, zone, lat: zone.latitude, lon: zone.longitude, code: zoneCodeOf(zone), n: perZone.get(stage.zone_id) ?? 0 }];
  });
  const zones = placed.map(({ stage, zone, lat, lon, code, n }) => {
    const radius = zone.extra?.['radius_km'];
    return { code, lat, lon, radiusKm: typeof radius === 'number' ? radius : 6, stage: stage.stage as LiveStage, ...(n === 0 ? {} : { label: `${code} · ${n}` }) };
  });
  const agentPins = statuses.map((s) => ({ id: s.agent_id, lat: s.latitude, lon: s.longitude, kind: s.status, label: agentNameOf(lookups.agentById.get(s.agent_id)) }));
  const casePins = placed.filter((p) => p.n > 0).map((p) => ({ id: `zone:${p.zone.id}`, lat: p.lat, lon: p.lon, kind: 'case' as const, label: `${p.code}: ${p.n}` }));
  const legend = LEGEND_STATUSES.map((status) => ({ status, count: statuses.filter((s) => s.status === status).length }));
  // Advisory: an arrow from the agent to the spot
  const marks = spotMarks(
    spots,
    (id) => {
      const st = lookups.statusByAgent.get(id);
      return st === undefined ? undefined : ([st.latitude, st.longitude] as const);
    },
    (id) => agentNameOf(lookups.agentById.get(id)),
  );
  return { zones, pins: [...agentPins, ...casePins, ...marks.pins], links: marks.links, legend, spots: marks.pins.length > 0 };
}

const UNMET_DAYS = 7;

/** One day of the api's out-of-reach log, every page. */
async function unmetLog(ctx: RequestContext, query: UnmetQuery): Promise<{ readonly date: string | undefined; readonly items: UnmetDemandCase[] }> {
  let date: string | undefined;
  const items = await everyPage(async (cursor) => {
    const page = await listUnmetDemand(ctx, { limit: PAGE, cursor, date: query.day, zone_id: query.zone, cause: query.cause });
    date = page.date;
    return page;
  });
  return { date, items };
}

// The log of the chosen day, already filtered
function unmetView(rows: readonly UnmetDemandCase[], zoneIds: readonly string[], lookups: Lookups, boardDay: string, day: string, threshold: number): LiveDispatchView['unmet'] {
  const viewRows: UnmetRowView[] = rows.map((r) => ({
    caseId: r.case_id,
    caseNumber: r.case_number,
    zoneId: r.zone_id,
    zoneCode: zoneCodeOf(lookups.zoneById.get(r.zone_id)),
    time: time(r.registered_at),
    nearestName: r.nearest_agent_id === null ? null : agentNameOf(lookups.agentById.get(r.nearest_agent_id)),
    travelMinutes: r.nearest_travel_seconds === null ? null : minutesOf(r.nearest_travel_seconds),
    cause: r.cause,
  }));
  const zoneOptions = [...new Set(zoneIds)].map((id) => ({ value: id, label: lookups.zoneById.get(id)?.name_en ?? zoneCodeOf(undefined) })).sort((a, b) => a.label.localeCompare(b.label));
  const dayOptions = Array.from({ length: UNMET_DAYS }, (_, i) => addDays(boardDay, -i));
  return { day, boardDay, dayOptions, zoneOptions, rows: viewRows, thresholdMinutes: Math.round(threshold / 60) };
}

export interface UnmetQuery {
  readonly zone?: string | undefined;
  readonly cause?: UnmetCause | undefined;
  readonly day?: string | undefined;
}

export async function loadLiveDispatchView(ctx: RequestContext, locale: string, query: UnmetQuery = {}): Promise<LiveDispatchView> {
  // Independent reads, all at once.
  const filtered = query.day !== undefined || query.zone !== undefined || query.cause !== undefined;
  const [board, zonePage, agents, statuses, snapshot, summary, comparisonPage, liveLog, chosenLog, spots] = await Promise.all([
    getLiveBoard(ctx, { limit: PAGE }),
    listZones(ctx, { limit: PAGE }),
    everyPage((cursor) => listAgents(ctx, { limit: PAGE, cursor })),
    everyPage((cursor) => listAgentStatuses(ctx, { limit: PAGE, cursor })),
    getSettingsSnapshot(ctx),
    getShadowComparisonSummary(ctx, {}),
    listShadowComparisons(ctx, { limit: COMPARISON_ROWS }),
    unmetLog(ctx, {}),
    filtered ? unmetLog(ctx, query) : undefined,
    listWaitingSpots(ctx),
  ]);
  // getLiveBoard sets replay; fail loudly if not.
  if (board.replay === undefined || board.replay === null) throw new Error('Live Dispatch Board: the replay state is missing.');
  const replayState = board.replay;
  const zones = zonePage.items;
  const lookups: Lookups = {
    zoneById: new Map(zones.map((z) => [z.id, z] as const)),
    agentById: new Map(agents.map((s) => [s.id, s] as const)),
    statusByAgent: new Map(statuses.map((s) => [s.agent_id, s] as const)),
    locale,
  };

  const nowMs = epochOf(replayState.replay_at);
  const comparisons = comparisonPage.items;
  const cards = board.cases.map((c) => ({ c, ...cardOf(c, lookups, nowMs) }));
  // Recommended cases need their options
  const [outputs, caseNumberById] = await Promise.all([
    mapLimited(cards, OPTION_CALLS, ({ c, card }) => (card.canDecide ? getCaseRecommendation(ctx, c.case_id) : Promise.resolve(undefined))),
    caseNumbersOf(ctx, comparisons.map((row) => row.case_id)),
  ]);
  const options = cards.map(({ c, card }, i) => {
    const output = outputs[i];
    return card.canDecide && output !== undefined ? overrideOptionsOf(output, c, lookups) : undefined;
  });
  const threshold = snapshot.ten_minute_threshold_seconds ?? DEFAULT_THRESHOLD_SECONDS;
  const causeByCase = new Map<string, UnmetCause>(liveLog.items.map((r) => [r.case_id, r.cause] as const));
  const columns = emptyColumns();
  cards.forEach(({ column, card }, i) => {
    const overrideOptions = options[i];
    const flagged = causeByCase.get(card.caseId) === 'geography' ? { ...card, overReach: true } : card;
    columns[column].push(overrideOptions === undefined ? flagged : { ...flagged, overrideOptions });
  });

  const stages = board.stages.map((s) => ({ zoneId: s.zone_id, zoneCode: zoneCodeOf(lookups.zoneById.get(s.zone_id)), stage: s.stage }));

  const fallback = {
    active: board.fallback.state !== 'armed',
    reason: board.fallback.reason,
    sinceTime: board.fallback.since === null ? null : time(board.fallback.since),
    timeoutSeconds: board.fallback.timeout_seconds,
    count: board.fallback.fallback_assigned_count,
  };

  const replay = {
    status: replayState.status,
    dateBoth: dateBoth(replayState.replay_date, { locale }),
    time: time(replayState.replay_at),
    deliveredCases: replayState.delivered_cases,
    totalCases: replayState.total_cases,
    feedOutageActive: replayState.feed_outage_active,
  };

  const reading = {
    clockStart: snapshot.clock_start,
    illustrative: summary.illustrative,
    customer: { fromAssignment: summary.customer.from_assignment.share, fromRegistration: summary.customer.from_registration.share },
    opendispatch: { fromAssignment: summary.opendispatch.from_assignment.share, fromRegistration: summary.opendispatch.from_registration.share },
    casesCompared: summary.cases_compared,
    fromDate: date(summary.from, { locale }),
    toDate: date(summary.to, { locale }),
  };

  const comparisonRows: ShadowComparisonRow[] = comparisons.map((row: AssignmentComparison) => ({
    id: row.id,
    caseNumber: caseNumberById.get(row.case_id) ?? row.case_id.slice(0, 8),
    zone: row.zone_id === undefined ? '—' : zoneCodeOf(lookups.zoneById.get(row.zone_id)),
    time: elapsedHm(row.compared_at),
    opendispatchName: row.opendispatch.agent_id === null ? '—' : agentNameOf(lookups.agentById.get(row.opendispatch.agent_id)),
    opendispatchMinutes: minutesOf(row.opendispatch.estimated_travel_seconds),
    customerName: row.customer.agent_id === null ? '—' : agentNameOf(lookups.agentById.get(row.customer.agent_id)),
    customerMinutes: minutesOf(row.customer.actual_travel_seconds),
    same: row.same_agent,
  }));

  const totalCases = BOARD_COLUMNS.reduce((sum, col) => sum + columns[col].length, 0);
  const waiting = waitingSpotsView(spots, (id) => agentNameOf(lookups.agentById.get(id)), (id) => zoneCodeOf(lookups.zoneById.get(id)));
  const sources = [...new Set([board.data_source, ...board.cases.map((c) => c.data_source), ...(waiting.rows.length > 0 ? [spots.data_source] : [])])];

  const chosen = chosenLog ?? liveLog;
  const unmet = unmetView(chosen.items, board.stages.map((s) => s.zone_id), lookups, replayState.replay_date, chosen.date ?? query.day ?? replayState.replay_date, threshold);

  return { replay, fallback, stages, columns, totalCases, overReachToday: liveLog.items.length, map: mapView(board, lookups, statuses, spots.enabled ? spots.items : []), reading, comparisons: comparisonRows, sources, unmet, waiting };
}

/** The bell's count, for the handover's Alerts tab. */
export async function unreadAlertCount(ctx: RequestContext): Promise<number> {
  try {
    return await countUnreadNotifications(ctx);
  } catch {
    return 0;
  }
}
