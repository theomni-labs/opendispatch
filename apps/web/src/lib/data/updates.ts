// SPDX-License-Identifier: AGPL-3.0-only
// Updates (a STUB): Go guards, audits and runs.

import type { UpdateApplyRun, UpdateChangePolicy, UpdateChangeWindows, UpdateConnectionSettings, UpdateConnectionTestResult, UpdateDownloadState, UpdateHistoryList, UpdateOfflineUploadResult, UpdatePreflightResult, UpdateRecoveryResult, UpdateRecoveryStatus, UpdateReleaseDetail, UpdateReleaseList, UpdateScheduledUpdate, UpdateSettings, UpdateStatus, UpdateUpcomingWindow, UpdatesSummary } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';

function releasePath(version: unknown): string {
  return `/updates/releases/${pathSegment(version)}`;
}

function pageQs(query: PageQuery & { readonly from?: string | undefined; readonly to?: string | undefined }): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

// operationId: getUpdatesSummary
export async function getUpdatesSummary(ctx: RequestContext): Promise<UpdatesSummary> {
  return (await businessFetch<UpdatesSummary>(ctx, '/updates/summary'))!;
}

// operationId: getUpdateStatus
export async function getUpdateStatus(ctx: RequestContext): Promise<UpdateStatus> {
  return (await businessFetch<UpdateStatus>(ctx, '/updates/status'))!;
}

// operationId: listUpdateReleases
export async function listUpdateReleases(ctx: RequestContext, query: PageQuery = {}): Promise<UpdateReleaseList> {
  return (await businessFetch<UpdateReleaseList>(ctx, `/updates/releases${pageQs(query)}`))!;
}

// operationId: getUpdateRelease
export async function getUpdateRelease(ctx: RequestContext, releaseVersion: string): Promise<UpdateReleaseDetail> {
  return requireFound(await businessFetch<UpdateReleaseDetail>(ctx, releasePath(releaseVersion)), `Release ${releaseVersion}`);
}

// operationId: getUpdateDownloadState
export async function getUpdateDownloadState(ctx: RequestContext, releaseVersion: string): Promise<UpdateDownloadState> {
  return requireFound(await businessFetch<UpdateDownloadState>(ctx, `${releasePath(releaseVersion)}/download`), `Release ${releaseVersion}`);
}

// operationId: getUpdatePreflight
export async function getUpdatePreflight(ctx: RequestContext, releaseVersion: string): Promise<UpdatePreflightResult> {
  return requireFound(await businessFetch<UpdatePreflightResult>(ctx, `${releasePath(releaseVersion)}/preflight`), `Release ${releaseVersion}`);
}

// operationId: getUpdateRun
export async function getUpdateRun(ctx: RequestContext, id: string): Promise<UpdateApplyRun> {
  return requireFound(await businessFetch<UpdateApplyRun>(ctx, `/updates/runs/${pathSegment(id)}`), 'Update run');
}

// operationId: listUpdateHistory
export async function listUpdateHistory(ctx: RequestContext, query: PageQuery & { readonly from?: string | undefined; readonly to?: string | undefined } = {}): Promise<UpdateHistoryList> {
  return (await businessFetch<UpdateHistoryList>(ctx, `/updates/history${pageQs(query)}`))!;
}

// operationId: getUpdateSettings
export async function getUpdateSettings(ctx: RequestContext): Promise<UpdateSettings> {
  return (await businessFetch<UpdateSettings>(ctx, '/updates/settings'))!;
}

// operationId: getUpdateConnection
export async function getUpdateConnection(ctx: RequestContext): Promise<UpdateConnectionSettings> {
  return (await businessFetch<UpdateConnectionSettings>(ctx, '/updates/connection'))!;
}

// operationId: getOfflineUpdateUpload
export async function getOfflineUpdateUpload(ctx: RequestContext, id: string): Promise<UpdateOfflineUploadResult> {
  return requireFound(await businessFetch<UpdateOfflineUploadResult>(ctx, `/updates/offline-uploads/${pathSegment(id)}`), 'Offline upload');
}

// operationId: getUpdateChangeWindows
export async function getUpdateChangeWindows(ctx: RequestContext): Promise<UpdateChangeWindows> {
  return (await businessFetch<UpdateChangeWindows>(ctx, '/updates/change-windows'))!;
}

// operationId: getNextUpdateWindow
export async function getNextUpdateWindow(ctx: RequestContext): Promise<UpdateUpcomingWindow> {
  return requireFound(await businessFetch<UpdateUpcomingWindow>(ctx, '/updates/change-windows/next'), 'An open change window');
}

// operationId: getUpdateChangePolicy
export async function getUpdateChangePolicy(ctx: RequestContext): Promise<UpdateChangePolicy> {
  return (await businessFetch<UpdateChangePolicy>(ctx, '/updates/change-policy'))!;
}

// operationId: getUpdateRecovery
export async function getUpdateRecovery(ctx: RequestContext): Promise<UpdateRecoveryStatus> {
  return (await businessFetch<UpdateRecoveryStatus>(ctx, '/updates/recovery'))!;
}

// ---------------------------------------------------------------------------------------------
// Writes (Go guards and audits each one)
// ---------------------------------------------------------------------------------------------

// operationId: checkForUpdatesNow
export async function checkForUpdatesNow(ctx: RequestContext): Promise<UpdateStatus> {
  return (await businessFetch<UpdateStatus>(ctx, '/updates/check', { method: 'POST' }))!;
}

// operationId: startUpdateDownload
export async function startUpdateDownload(ctx: RequestContext, releaseVersion: string): Promise<UpdateDownloadState> {
  return (await businessFetch<UpdateDownloadState>(ctx, `${releasePath(releaseVersion)}/download`, { method: 'POST' }))!;
}

// operationId: runUpdatePreflight
export async function runUpdatePreflight(ctx: RequestContext, releaseVersion: string): Promise<UpdatePreflightResult> {
  return (await businessFetch<UpdatePreflightResult>(ctx, `${releasePath(releaseVersion)}/preflight`, { method: 'POST' }))!;
}

// operationId: confirmUpdateBackup
export async function confirmUpdateBackup(ctx: RequestContext, releaseVersion: string, body: unknown = {}): Promise<UpdatePreflightResult> {
  return (await businessFetch<UpdatePreflightResult>(ctx, `${releasePath(releaseVersion)}/backup-confirmation`, { method: 'POST', body: body ?? null }))!;
}

// operationId: scheduleUpdate
export async function scheduleUpdate(ctx: RequestContext, releaseVersion: string, body: unknown = {}): Promise<UpdateScheduledUpdate> {
  return (await businessFetch<UpdateScheduledUpdate>(ctx, `${releasePath(releaseVersion)}/schedule`, { method: 'POST', body: body ?? null }))!;
}

// operationId: cancelScheduledUpdate
export async function cancelScheduledUpdate(ctx: RequestContext, releaseVersion: string): Promise<UpdateReleaseDetail> {
  return (await businessFetch<UpdateReleaseDetail>(ctx, `${releasePath(releaseVersion)}/schedule`, { method: 'DELETE' }))!;
}

// operationId: approveUpdate
export async function approveUpdate(ctx: RequestContext, releaseVersion: string, body: unknown = {}): Promise<UpdateScheduledUpdate> {
  return (await businessFetch<UpdateScheduledUpdate>(ctx, `${releasePath(releaseVersion)}/approve`, { method: 'POST', body: body ?? null }))!;
}

// operationId: rejectUpdate
export async function rejectUpdate(ctx: RequestContext, releaseVersion: string, body: unknown = {}): Promise<UpdateScheduledUpdate> {
  return (await businessFetch<UpdateScheduledUpdate>(ctx, `${releasePath(releaseVersion)}/reject`, { method: 'POST', body: body ?? null }))!;
}

// operationId: applyUpdate
export async function applyUpdate(ctx: RequestContext, releaseVersion: string): Promise<UpdateApplyRun> {
  return (await businessFetch<UpdateApplyRun>(ctx, `${releasePath(releaseVersion)}/apply`, { method: 'POST' }))!;
}

// operationId: skipUpdate
export async function skipUpdate(ctx: RequestContext, releaseVersion: string, body: unknown): Promise<UpdateReleaseDetail> {
  return (await businessFetch<UpdateReleaseDetail>(ctx, `${releasePath(releaseVersion)}/skip`, { method: 'POST', body: body ?? null }))!;
}

// operationId: requestUpdateEmergencyOverride
export async function requestUpdateEmergencyOverride(ctx: RequestContext, body: unknown): Promise<UpdateApplyRun> {
  return (await businessFetch<UpdateApplyRun>(ctx, '/updates/emergency-override', { method: 'POST', body: body ?? null }))!;
}

// operationId: requestUpdateRecovery
export async function requestUpdateRecovery(ctx: RequestContext, body: unknown): Promise<UpdateRecoveryResult> {
  return (await businessFetch<UpdateRecoveryResult>(ctx, '/updates/recovery', { method: 'POST', body: body ?? null }))!;
}

// operationId: updateUpdateSettings
export async function updateUpdateSettings(ctx: RequestContext, body: unknown): Promise<UpdateSettings> {
  return (await businessFetch<UpdateSettings>(ctx, '/updates/settings', { method: 'PUT', body: body ?? null }))!;
}

// operationId: updateUpdateConnection
export async function updateUpdateConnection(ctx: RequestContext, body: unknown): Promise<UpdateConnectionSettings> {
  return (await businessFetch<UpdateConnectionSettings>(ctx, '/updates/connection', { method: 'PUT', body: body ?? null }))!;
}

// operationId: testUpdateConnection
export async function testUpdateConnection(ctx: RequestContext): Promise<UpdateConnectionTestResult> {
  return (await businessFetch<UpdateConnectionTestResult>(ctx, '/updates/connection/test', { method: 'POST' }))!;
}

// operationId: uploadOfflineUpdate
export async function uploadOfflineUpdate(ctx: RequestContext, body: unknown): Promise<UpdateOfflineUploadResult> {
  return (await businessFetch<UpdateOfflineUploadResult>(ctx, '/updates/offline-uploads', { method: 'POST', body: body ?? null }))!;
}

// operationId: updateUpdateChangeWindows
export async function updateUpdateChangeWindows(ctx: RequestContext, body: unknown): Promise<UpdateChangeWindows> {
  return (await businessFetch<UpdateChangeWindows>(ctx, '/updates/change-windows', { method: 'PUT', body: body ?? null }))!;
}

// operationId: updateUpdateChangePolicy
export async function updateUpdateChangePolicy(ctx: RequestContext, body: unknown): Promise<UpdateChangePolicy> {
  return (await businessFetch<UpdateChangePolicy>(ctx, '/updates/change-policy', { method: 'PUT', body: body ?? null }))!;
}

// operationId: patchUpdateConnection
export async function patchUpdateConnection(ctx: RequestContext, body: unknown): Promise<UpdateConnectionSettings> {
  return (await businessFetch<UpdateConnectionSettings>(ctx, '/updates/connection', { method: 'PATCH', body: body ?? null }))!;
}

// operationId: patchUpdateChangeWindows
export async function patchUpdateChangeWindows(ctx: RequestContext, body: unknown): Promise<UpdateChangeWindows> {
  return (await businessFetch<UpdateChangeWindows>(ctx, '/updates/change-windows', { method: 'PATCH', body: body ?? null }))!;
}

// operationId: patchUpdateChangePolicy
export async function patchUpdateChangePolicy(ctx: RequestContext, body: unknown): Promise<UpdateChangePolicy> {
  return (await businessFetch<UpdateChangePolicy>(ctx, '/updates/change-policy', { method: 'PATCH', body: body ?? null }))!;
}
