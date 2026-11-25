// Every *.live.test.ts file that needs a disposable roster date picks one
// from freshDate(bandIndex). Each file used to roll its own small random
// offset off 2026-09-13 -- narrow enough that two files' offsets collided
// under a real full-sweep run (found in CI: a date one file used as
// "definitely has no roster" landed on a date another file's disposable
// roster occupied).
//
// Can't fix this by widening the random range: rosters.ts's own buildRoster
// refuses any date more than MAX_BUILD_DAYS_AHEAD (60) days past demo
// "today" (2026-09-13, fixed -- not the real current date), so
// every disposable roster date in the whole repo is confined to the same
// 60-day window. That's not wide enough for independent randomness across
// files to be collision-safe. Instead: give each file a small, deterministic,
// non-overlapping band within that window. Bands never overlap by
// construction, so two files can never land on the same date no matter how
// many times either calls freshDate().
const TODAY = new Date('2026-09-13T00:00:00Z');
// Days 1-12 (2026-09-14 through 2026-09-25) are excluded on purpose: real
// hardcoded roster_date literals for Riyadh Central already live there
// across several files (09-14/15 submitted+draft fixture rosters that stay
// read-only everywhere; 09-16, 09-17, 09-20, 09-21, 09-25 are direct literal
// buildRoster/view calls in rosters.live.test.ts, field_planner's own tests
// and break_planner/view.live.test.ts). Checked repo-wide (grep, both this
// range and further out) before picking day 15 as the start -- nothing else
// hardcoded past day 12 was found.
const WINDOW_START = 15;
// 5 bands x 9 = 45, last day = 15 + 45 - 1 = 59 (<=60). No spare band right
// now -- widening past 5 needs either a smaller BAND_WIDTH (every file's
// call count must still fit) or pushing WINDOW_START/60 itself, not just
// bumping this constant.
const BAND_WIDTH = 9;
// One more literal past day 12, found the hard way (day 42 = 2026-10-25 is
// field_planner/view.live.test.ts's own "definitely no roster" date; the
// first pass here didn't check the *raw* band ranges against literals past
// day 12, only the days already reserved below it). Skipped entirely: any
// raw offset from day 42 on shifts by one, so 42 itself is never produced.
const EXCLUDED_DAY = 42;

// Band registry -- keep in sync. Add the next file at the next free index;
// do not reuse an index while its file still calls freshDate(). Band 4 is
// currently unused (standby_coverage/actions.live.test.ts was converted to
// read through getCoverage/the demo store instead -- see that file).
//  0: apps/web/src/lib/data/breaks.live.test.ts
//  1: apps/web/src/lib/data/rosters.live.test.ts
//  2: apps/web/src/screens/ops/break_planner/actions.live.test.ts
//  3: apps/web/src/screens/ops/field_planner/actions.live.test.ts
//  4: field_planner/actions.live.test.ts week build (2026-11-08 to 11-12, a literal)
const MAX_BAND_INDEX = 4;

const callsPerBand = new Map<number, number>();

export function freshDate(bandIndex: number): string {
  if (bandIndex < 0 || bandIndex > MAX_BAND_INDEX || !Number.isInteger(bandIndex)) {
    throw new Error(`freshDate: bandIndex must be an integer 0-${MAX_BAND_INDEX}, got ${bandIndex}`);
  }
  const callsSoFar = callsPerBand.get(bandIndex) ?? 0;
  const nextCall = callsSoFar + 1;
  if (nextCall > BAND_WIDTH) {
    throw new Error(`freshDate: band ${bandIndex} exhausted its ${BAND_WIDTH}-day budget -- widen BAND_WIDTH or free a band in live-fixtures.ts`);
  }
  callsPerBand.set(bandIndex, nextCall);
  const rawOffset = WINDOW_START + bandIndex * BAND_WIDTH + (nextCall - 1);
  const offset = rawOffset >= EXCLUDED_DAY ? rawOffset + 1 : rawOffset;
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
