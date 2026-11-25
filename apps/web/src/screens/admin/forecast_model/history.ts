// SPDX-License-Identifier: AGPL-3.0-only
export type Level = 'zone' | 'sub_zone' | 'city';
export type Clock = 'assignment' | 'registration';
export type CalendarSource = 'customer' | 'settings';
export type GateBaseline = 'naive' | 'segment';

export type HistoryTitle =
  | { readonly key: 'run'; readonly vars: { readonly model: string } }
  | { readonly key: 'switched'; readonly vars: { readonly from: string; readonly to: string } }
  | { readonly key: 'challengerRun' | 'backtest' | 'backtestStarted'; readonly vars: { readonly model: string } }
  | { readonly key: 'runCal' | 'challengerRunCal'; readonly vars: { readonly model: string; readonly calendar: CalendarSource } }
  | { readonly key: 'backtestFailed'; readonly vars: { readonly cls: string } }
  | { readonly key: 'lift'; readonly vars: { readonly challenger: string; readonly champion: string } }
  | { readonly key: 'challengerSkipped'; readonly vars: { readonly challenger: string; readonly model: string } }
  | { readonly key: 'degraded'; readonly vars: { readonly n: string; readonly model: string } }
  | { readonly key: 'paused' | 'resumed'; readonly vars: Record<string, never> }
  | { readonly key: 'retrain'; readonly vars: { readonly cad: string } }
  | { readonly key: 'clock'; readonly vars: { readonly v: Clock } }
  | { readonly key: 'level'; readonly vars: { readonly v: Level } }
  | { readonly key: 'optimizer'; readonly vars: { readonly v: string } }
  | { readonly key: 'challenger'; readonly vars: { readonly model: string } }
  | { readonly key: 'challengerOff'; readonly vars: Record<string, never> }
  | { readonly key: 'gateBaseline'; readonly vars: { readonly v: GateBaseline } };

const RUN = /^Forecast run for \d+ day\(s\) from \d{4}-\d{2}-\d{2} finished \((?:engine \S+, model (\S+?)(?:, calendar (.+?))?|placeholder model (\S+?), Illustrative)\)\.$/;
const CHALLENGER = /^Challenger forecast run for \d+ day\(s\) from \d{4}-\d{2}-\d{2} finished \(engine \S+, model (\S+?)(?:, calendar (.+?))?\)\.$/;

// Go's forecastcal.SourceCustomer and SourceSettings
const CALENDARS: Record<string, CalendarSource> = { 'Customer Unified Planning Calendar': 'customer', 'derived from settings': 'settings' };
const BACKTEST = /^Forecast backtest on \S* to \S* finished: \S+ \(model (\S+?), \S+\)\.(?: Challenger (\S+?)(?: against \S+: WAPE lift \S+, MAPE lift \S+|: no lift)\.)?$/;
const SKIPPED = /^Challenger (\S+) not stored: the engine ran (\S+?)\.$/;
const BT_START =/^Forecast backtest started \(model (\S+?)\)\.$/;
const BT_FAIL = /^Forecast backtest failed \((\S+?)\)\.$/;
const DEGRADED = /^Forecast error above the limit in (\d+) zone\(s\) (?:on|over the \d+ day\(s\) to) \d{4}-\d{2}-\d{2} \(model (\S+?), limit \d+%\)\.$/;
const SWITCH = /^Forecast model (\S+) made active(?: \(was (.*)\))?\.$/;
const RETRAIN = /^Retraining schedule changed to (manual|daily|weekly|monthly)(?: at \d\d:\d\d)?\.$/;
const CLOCK = /^10-minute clock start changed from \w+ to (assignment|registration)\.$/;
const LEVEL = /^Planning level changed from \w+ to (zone|sub_zone|city)\.$/;
const OPTIMIZER = /^Optimizer model changed from \S+ to (\S+?)\.$/;
const CHALLENGER_SET = /^Challenger changed from \S+ to (\S+?)\.$/;
const GATE_BASE = /^Backtest gate baseline changed from \w+ to (naive|segment)\.$/;

// Null: no message for the text, shown as written
export function historyTitle(summaryEn: string): HistoryTitle | null {
  const run = RUN.exec(summaryEn);
  if (run !== null) {
    const calendar = run[2] === undefined ? undefined : CALENDARS[run[2]];
    const model = (run[1] ?? run[3]) as string;
    return calendar === undefined ? { key: 'run', vars: { model } } : { key: 'runCal', vars: { model, calendar } };
  }
  const challenger = CHALLENGER.exec(summaryEn);
  if (challenger !== null) {
    const calendar = challenger[2] === undefined ? undefined : CALENDARS[challenger[2]];
    const model = challenger[1] as string;
    return calendar === undefined ? { key: 'challengerRun', vars: { model } } : { key: 'challengerRunCal', vars: { model, calendar } };
  }
  const backtest = BACKTEST.exec(summaryEn);
  if (backtest !== null) return backtest[2] === undefined ? { key: 'backtest', vars: { model: backtest[1] as string } } : { key: 'lift', vars: { challenger: backtest[2], champion: backtest[1] as string } };
  const skipped = SKIPPED.exec(summaryEn);
  if (skipped !== null) return { key: 'challengerSkipped', vars: { challenger: skipped[1] as string, model: skipped[2] as string } };
  const started = BT_START.exec(summaryEn);
  if (started !== null) return { key: 'backtestStarted', vars: { model: started[1] as string } };
  const failed = BT_FAIL.exec(summaryEn);
  if (failed !== null) return { key: 'backtestFailed', vars: { cls: failed[1] as string } };
  const degraded = DEGRADED.exec(summaryEn);
  if (degraded !== null) return { key: 'degraded', vars: { n: degraded[1] as string, model: degraded[2] as string } };
  const switched = SWITCH.exec(summaryEn);
  if (switched !== null) return { key: 'switched', vars: { from: switched[2] ?? '', to: switched[1] as string } };
  if (summaryEn.startsWith('Forecast paused')) return { key: 'paused', vars: {} };
  if (summaryEn.startsWith('Forecast resumed')) return { key: 'resumed', vars: {} };
  const retrain = RETRAIN.exec(summaryEn);
  if (retrain !== null) return { key: 'retrain', vars: { cad: retrain[1] as string } };
  const clock = CLOCK.exec(summaryEn);
  if (clock !== null) return { key: 'clock', vars: { v: clock[1] as Clock } };
  const level = LEVEL.exec(summaryEn);
  if (level !== null) return { key: 'level', vars: { v: level[1] as Level } };
  const optimizer = OPTIMIZER.exec(summaryEn);
  if (optimizer !== null) return { key: 'optimizer', vars: { v: optimizer[1] as string } };
  const chosen = CHALLENGER_SET.exec(summaryEn);
  if (chosen !== null) return chosen[1] === 'none' ? { key: 'challengerOff', vars: {} } : { key: 'challenger', vars: { model: chosen[1] as string } };
  const base = GATE_BASE.exec(summaryEn);
  if (base !== null) return { key: 'gateBaseline', vars: { v: base[1] as GateBaseline } };
  return null;
}

export const MARK = '\u0001';

// Splits a message at the marks: odd parts are data
export function splitData(text: string): { readonly text: string; readonly data: boolean }[] {
  return text.split(MARK).map((part, i) => ({ text: part, data: i % 2 === 1 }));
}
