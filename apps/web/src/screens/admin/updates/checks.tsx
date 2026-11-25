// SPDX-License-Identifier: AGPL-3.0-only
import type { Tone } from '@opendispatch/ui';
import type { ReactNode } from 'react';
import type { CheckRow } from './UpdatesShared';
import { DataText } from './UpdatesShared';
import type { CheckId, CheckStatus, DownloadView, ImageState, PreflightView, RunStepName, RunStepState, RunView, VerificationView } from './types';

// The rows of the check lists of the Updates screen, built from the data the agent returns. Pure and translator-driven: the
// text of a check comes from its id and its result, in the reader's language; only what the data layer alone knows (the
// reason of a failed check, the message of a step it could not describe) stays English, marked as data.
//
// `m` is the module's translator (`admin.updates`). Keys are written out in full so the message scan can check them.

export type Translate = (key: string, values?: Record<string, string | number>) => string;

const IMAGE_TONE: Readonly<Record<ImageState, Tone>> = { pending: 'neutral', pulled: 'info', pushed_to_registry: 'success', verified: 'success', failed: 'danger' };

/** The images of a download: waiting, downloading (the first that is not pulled yet), pulled, in the registry. The contract has no size per image. */
export function imageRows(download: DownloadView, m: Translate): CheckRow[] {
  let firstOpen = true;
  return download.images.map((image) => {
    const opening = image.state === 'pending' && firstOpen && download.state === 'downloading';
    if (image.state === 'pending') firstOpen = false;
    const tone: Tone = opening ? 'info' : IMAGE_TONE[image.state];
    const pill =
      opening ? m('img.downloading') : image.state === 'pending' ? m('img.pending') : image.state === 'pulled' ? m('img.pulled') : image.state === 'pushed_to_registry' ? m('img.pushed') : image.state === 'verified' ? m('pf.passed') : m('st.failed');
    return { key: image.name, tone, pill, title: <span translate="no">{image.name}</span> };
  });
}

type VerifyKey = 'sig' | 'digest' | 'key' | 'newer' | 'index';
const VERIFY_ORDER: readonly VerifyKey[] = ['sig', 'digest', 'key', 'newer', 'index'];

function failedVerify(v: VerificationView, key: VerifyKey): boolean {
  return key === 'sig' ? !v.signatureValid : key === 'digest' ? !v.digestsMatch : key === 'key' ? v.keyRevoked : key === 'newer' ? v.olderThanInstalled : v.indexExpired;
}

export interface VerifyContext {
  readonly version: string;
  readonly current: string;
  readonly images: readonly string[];
  readonly indexValidUntil: string | null;
  /** Dates through the shared formatter. */
  readonly date: (iso: string) => string;
  /** The image whose digest does not match, from the data layer's message (the worker in the scripted case). */
  readonly badImage: string | null;
  /** The release index only matters in connected mode: a file is not checked against it. */
  readonly connected: boolean;
}

function verifyName(key: VerifyKey, m: Translate): string {
  return key === 'sig' ? m('v.sig') : key === 'digest' ? m('v.digest') : key === 'key' ? m('v.key') : key === 'newer' ? m('v.newer') : m('v.index');
}

function verifyMeta(key: VerifyKey, failed: boolean, v: VerificationView | null, ctx: VerifyContext, m: Translate): ReactNode {
  if (key === 'sig') return v?.keyId ? <span dir="ltr" translate="no">{v.keyId}</span> : undefined;
  if (key === 'digest') {
    if (failed) return <span>{ctx.badImage === null ? m('v.digestBad') : <><bdi dir="ltr" translate="no">{ctx.badImage}</bdi> {m('v.digestBad')}</>}</span>;
    return <span dir="ltr" translate="no">{ctx.images.join(', ')}</span>;
  }
  if (key === 'newer') return <span dir="ltr" translate="no">{`${ctx.version} > ${ctx.current}`}</span>;
  if (key === 'index' && ctx.connected && ctx.indexValidUntil !== null) return <span>{m('v.until')} <bdi dir="ltr" translate="no">{ctx.date(ctx.indexValidUntil)}</bdi></span>;
  return undefined;
}

/**
 * The five checks of a verification. `verification: null` while the phase runs: the contract has no per-check progress, so every
 * check is shown as running and the result appears when the phase ends (never a made-up step-by-step animation).
 */
export function verifyRows(verification: VerificationView | null, ctx: VerifyContext, m: Translate): CheckRow[] {
  return VERIFY_ORDER.filter((key) => key !== 'index' || ctx.connected).map((key) => {
    if (verification === null) return { key, tone: 'info', pill: m('st.run'), title: verifyName(key, m) } satisfies CheckRow;
    const failed = failedVerify(verification, key);
    return { key, tone: failed ? 'danger' : 'success', pill: failed ? m('st.failed') : m('pf.passed'), title: verifyName(key, m), meta: verifyMeta(key, failed, verification, ctx, m) } satisfies CheckRow;
  });
}

/** Why a verification failed, in one line the reader understands: the first check that failed. */
export function verifyReason(v: VerificationView | null, m: Translate): string | null {
  if (v === null) return null;
  if (!v.digestsMatch) return m('vf.reasonDigest');
  if (!v.signatureValid) return m('vf.reasonSig');
  if (v.keyRevoked) return m('vf.reasonKey');
  if (v.olderThanInstalled) return m('vf.reasonOlder');
  if (v.indexExpired) return m('vf.reasonIndex');
  return null;
}

// ---------------------------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------------------------

const CHECK_TONE: Readonly<Record<CheckStatus, Tone>> = { pending: 'neutral', running: 'info', passed: 'success', failed: 'danger', needs_confirmation: 'warning' };

function checkName(id: CheckId, m: Translate): string {
  return id === 'disk_and_registry_space' ? m('pf.disk') : id === 'database_reachable' ? m('pf.db') : id === 'recent_backup' ? m('pf.backup') : id === 'upgrade_path_allowed' ? m('pf.path') : id === 'system_healthy' ? m('pf.health') : m('pf.migr');
}

export function checkPill(status: CheckStatus, m: Translate): string {
  return status === 'passed' ? m('pf.passed') : status === 'failed' ? m('st.failed') : status === 'needs_confirmation' ? m('pf.needs') : status === 'running' ? m('st.run') : m('st.wait');
}

/** The detail line of a check: translated when it passed or waits, the data layer's English reason when it failed. */
function checkMeta(id: CheckId, status: CheckStatus, message: string | null, from: string, to: string, migrations: number, estimate: number | null, m: Translate): ReactNode {
  if (status === 'pending' || status === 'running') return undefined;
  if (status === 'failed') return message === null ? undefined : <DataText>{message}</DataText>;
  switch (id) {
    case 'disk_and_registry_space':
      return m('pf.diskM');
    case 'database_reachable':
      return m('pf.dbM');
    case 'recent_backup':
      return status === 'needs_confirmation' ? m('pf.backupAsk') : m('pf.backupDone');
    case 'upgrade_path_allowed':
      return m('pf.pathM', { a: from, b: to });
    case 'system_healthy':
      return m('pf.healthM');
    case 'migration_rehearsal':
      return migrations === 0 ? m('pf.migr0') : m('pf.migrN', { n: migrations, s: estimate ?? 0 });
  }
}

export function preflightRows(preflight: PreflightView, from: string, to: string, migrations: number, m: Translate): CheckRow[] {
  return preflight.checks.map((check) => ({
    key: check.id,
    tone: CHECK_TONE[check.status],
    pill: checkPill(check.status, m),
    title: checkName(check.id, m),
    meta: checkMeta(check.id, check.status, check.message, from, to, migrations, preflight.estimateSeconds, m),
  }));
}

/** "6 of 6 passed" for the Pre-flight fact of the release card. */
export function passedCount(preflight: PreflightView | null): number {
  return preflight === null ? 0 : preflight.checks.filter((check) => check.status === 'passed').length;
}

// ---------------------------------------------------------------------------------------------
// The steps of a run
// ---------------------------------------------------------------------------------------------

const STEP_TONE: Readonly<Record<RunStepState, Tone>> = { pending: 'neutral', running: 'info', succeeded: 'success', failed: 'danger', skipped: 'neutral' };

function stepName(name: RunStepName, m: Translate): string {
  switch (name) {
    case 'record_revisions':
      return m('st.rev');
    case 'confirm_backup':
      return m('st.backup');
    case 'fallback_and_maintenance_on':
      return m('st.fallback');
    case 'migrate_platform':
      return m('st.plat');
    case 'migrate_opendispatch':
      return m('st.opendispatch');
    case 'helm_upgrade':
      return m('st.helm');
    case 'smoke_tests':
      return m('st.smoke');
    case 'maintenance_off':
      return m('st.maint');
    case 'report':
      return m('st.report');
  }
}

/** The mockup's line for a step of a run, by step, state and what kind of run it is (a resume skips the steps of the original run). */
function stepNote(name: RunStepName, state: RunStepState, run: RunView, m: Translate): string {
  if (state === 'pending') return m('rm.wait');
  const resume = run.kind === 'resume';
  const rolledBack = run.state === 'rolled_back';
  switch (name) {
    case 'record_revisions':
      return resume && state === 'skipped' ? m('rm.origin') : m('rm.rev');
    case 'confirm_backup':
      return resume && state === 'skipped' ? m('rm.origin') : m('rm.backup');
    case 'fallback_and_maintenance_on':
      return resume && state === 'skipped' ? m('rm.origin') : state === 'skipped' ? m('rm.fallbackSkip') : m('rm.fallbackOn');
    case 'migrate_platform':
      return resume && state === 'skipped' ? m('rm.origin') : m('rm.plat');
    case 'migrate_opendispatch':
      return state === 'failed' ? m('rm.opendispatchFail') : state === 'skipped' ? m('rm.noMigr') : resume ? m('rm.opendispatchResumed') : m('rm.opendispatchOk');
    case 'helm_upgrade':
      return m('rm.helm');
    case 'smoke_tests':
      return state === 'failed' ? m('rm.smokeFail') : m('rm.smokeOk');
    case 'maintenance_off':
      return rolledBack ? m('rm.maintRb') : state === 'skipped' ? m('rm.maintNone') : m('rm.maintOff');
    case 'report':
      return rolledBack ? m('rm.reportRb') : m('rm.reportOk');
  }
}

function stepPill(state: RunStepState, m: Translate): string {
  return state === 'succeeded' ? m('st.done') : state === 'failed' ? m('st.failed') : state === 'skipped' ? m('st.skipped') : state === 'running' ? m('st.run') : m('st.wait');
}

export function runRows(run: RunView, m: Translate): CheckRow[] {
  return run.steps.map((step) => ({ key: step.name, tone: STEP_TONE[step.state], pill: stepPill(step.state, m), title: stepName(step.name, m), meta: stepNote(step.name, step.state, run, m) }));
}
