// SPDX-License-Identifier: AGPL-3.0-only
// Remote roster gaps and duration sums (pure)

/** One 15-minute staffing interval, as getRemoteStaffing returns it. */
export interface PlanInterval {
  readonly index: number;
  readonly required: number;
  readonly planned: number;
}

export interface DayLoad {
  readonly demandHours: number;
  readonly capacityHours: number;
  readonly gapHours: number;
  /** The most negative planned - required, with its interval; null with no gap. */
  readonly worst: { readonly delta: number; readonly index: number } | null;
}

const STEP_HOURS = 0.25;

/** Demand, capacity and gap of a day. */
export function dayLoad(intervals: readonly PlanInterval[]): DayLoad {
  let demand = 0;
  let capacity = 0;
  let worst: DayLoad['worst'] = null;
  for (const i of intervals) {
    demand += i.required * STEP_HOURS;
    capacity += i.planned * STEP_HOURS;
    const delta = i.planned - i.required;
    if (delta < 0 && (worst === null || delta < worst.delta)) worst = { delta, index: i.index };
  }
  return { demandHours: demand, capacityHours: capacity, gapHours: capacity - demand, worst };
}

/** Runs of intervals below required, worst first. */
export function gapRuns(intervals: readonly PlanInterval[]): { readonly from: number; readonly to: number; readonly short: number }[] {
  const sorted = [...intervals].sort((a, b) => a.index - b.index);
  const runs: { from: number; to: number; short: number }[] = [];
  let open: { from: number; to: number; short: number } | null = null;
  for (const i of sorted) {
    const delta = i.planned - i.required;
    if (delta < 0) {
      if (open !== null && open.to === i.index * STEP_HOURS) {
        open.to += STEP_HOURS;
        open.short = Math.max(open.short, -delta);
      } else {
        open = { from: i.index * STEP_HOURS, to: (i.index + 1) * STEP_HOURS, short: -delta };
        runs.push(open);
      }
    } else open = null;
  }
  return runs;
}

/** The middle value; null with none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** One remote case's times (ISO strings). */
export interface CaseTimes {
  readonly registeredAt: string;
  readonly reviewAt: string | null;
  readonly closedAt: string | null;
  readonly caseTypeId: string;
  readonly reviewerId?: string | null | undefined;
}

export interface Durations {
  readonly cases: number;
  readonly handled: number;
  readonly waitSeconds: number | null;
  readonly completeSeconds: number | null;
  readonly meanCompleteSeconds: number | null;
  readonly receiptToCloseSeconds: number | null;
}

function seconds(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  const s = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}

const present = (v: number | null): v is number => v !== null;

/** Medians of wait, time to complete, receipt to close. */
export function durations(cases: readonly CaseTimes[]): Durations {
  const complete = cases.map((c) => seconds(c.reviewAt, c.closedAt)).filter(present);
  return {
    cases: cases.length,
    handled: cases.filter((c) => c.closedAt !== null).length,
    waitSeconds: median(cases.map((c) => seconds(c.registeredAt, c.reviewAt)).filter(present)),
    completeSeconds: median(complete),
    meanCompleteSeconds: complete.length === 0 ? null : complete.reduce((a, b) => a + b, 0) / complete.length,
    receiptToCloseSeconds: median(cases.map((c) => seconds(c.registeredAt, c.closedAt)).filter(present)),
  };
}

/** Durations per key, largest group first. */
export function groupDurations(cases: readonly CaseTimes[], keyOf: (c: CaseTimes) => string | null): { readonly key: string; readonly durations: Durations }[] {
  const groups = new Map<string, CaseTimes[]>();
  for (const c of cases) {
    const key = keyOf(c);
    if (key === null) continue;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [c]);
    else list.push(c);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, durations: durations(list) })).sort((a, b) => b.durations.cases - a.durations.cases || a.key.localeCompare(b.key));
}
