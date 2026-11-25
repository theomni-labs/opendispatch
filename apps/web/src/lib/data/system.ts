// SPDX-License-Identifier: AGPL-3.0-only
// System administration: thin Go client.

import type {
  ApiClientCreated,
  ApiClientList,
  ApiRateLimits,
  BackupStatus,
  ControlEvidence,
  ControlEvidenceList,
  DiagnosticsBundle,
  EngineStatuses,
  HealthOverview,
  HealthStatus,
  Integration,
  IntegrationList,
  IntegrationsHealth,
  IntegrationTestResult,
  JobRun,
  JobRunList,
  LocalizationSettings,
  SessionPolicy,
  StorageStatus,
  SupportAccessEvent,
  SupportAccessEventList,
  SupportAccessSetting,
  Webhook,
  WebhookDeliveryList,
  WebhookDeliveryRetryResult,
  WebhookList,
  WebhookTestResult,
} from '@/lib/types';
import { requireFound, requirePlatform, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

const page = (query: PageQuery) => ({ limit: query.limit, cursor: query.cursor });

// ---------------------------------------------------------------------------------------------
// System health, storage, backups, diagnostics (admin.system_health)
// ---------------------------------------------------------------------------------------------

// operationId: listJobRuns
export async function listJobRuns(
  ctx: RequestContext,
  query: PageQuery & { readonly from?: string | undefined; readonly to?: string | undefined; readonly status?: JobRun['status'] | undefined; readonly kind?: JobRun['kind'] | undefined } = {},
): Promise<JobRunList> {
  return (await businessFetch<JobRunList>(ctx, `/health/jobs${qs({ ...page(query), from: query.from, to: query.to, status: query.status, kind: query.kind })}`))!;
}

// operationId: getSystemHealth
export async function getSystemHealth(ctx: RequestContext): Promise<HealthOverview> {
  return (await businessFetch<HealthOverview>(ctx, '/health/overview'))!;
}

// operationId: getEngineStatuses
export async function getEngineStatuses(ctx: RequestContext): Promise<EngineStatuses> {
  return (await businessFetch<EngineStatuses>(ctx, '/system/engines'))!;
}

// operationId: getStorageStatus
export async function getStorageStatus(ctx: RequestContext): Promise<StorageStatus> {
  return (await businessFetch<StorageStatus>(ctx, '/health/storage'))!;
}

// operationId: getBackupStatus
export async function getBackupStatus(ctx: RequestContext): Promise<BackupStatus> {
  return (await businessFetch<BackupStatus>(ctx, '/health/backups'))!;
}

// operationId: confirmBackup
export async function confirmBackup(ctx: RequestContext, body: unknown = {}): Promise<BackupStatus> {
  return (await businessFetch<BackupStatus>(ctx, '/health/backups/confirm', { method: 'POST', body }))!;
}

// operationId: createDiagnosticsBundle
export async function createDiagnosticsBundle(ctx: RequestContext): Promise<DiagnosticsBundle> {
  return (await businessFetch<DiagnosticsBundle>(ctx, '/health/diagnostics', { method: 'POST' }))!;
}

/** The archive of a diagnostics bundle. The bytes are returned base64 encoded so the result stays JSON. */
// operationId: downloadDiagnosticsBundle
export async function downloadDiagnosticsBundle(ctx: RequestContext, id: string): Promise<{ readonly file_name: string; readonly content_type: 'application/zip'; readonly content_base64: string }> {
  return requireFound(await businessFetch<{ file_name: string; content_type: 'application/zip'; content_base64: string }>(ctx, `/health/diagnostics/${pathSegment(id)}/download-base64`), 'Diagnostics bundle');
}

// ---------------------------------------------------------------------------------------------
// Health probes (platform.session)
// ---------------------------------------------------------------------------------------------

// operationId: getLiveness
export async function getLiveness(ctx: RequestContext): Promise<HealthStatus> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<HealthStatus>(ctx, '/healthz'))!;
}

// operationId: getReadiness
export async function getReadiness(ctx: RequestContext): Promise<HealthStatus> {
  requirePlatform(ctx, 'platform.session');
  return (await businessFetch<HealthStatus>(ctx, '/readyz'))!;
}

// ---------------------------------------------------------------------------------------------
// Security and compliance (admin.security_compliance)
// ---------------------------------------------------------------------------------------------

// operationId: listControlEvidence
export async function listControlEvidence(ctx: RequestContext, query: PageQuery & { readonly framework?: ControlEvidence['framework'] | undefined } = {}): Promise<ControlEvidenceList> {
  return (await businessFetch<ControlEvidenceList>(ctx, `/security/controls${qs({ ...page(query), framework: query.framework })}`))!;
}

// operationId: updateControlEvidence
export async function updateControlEvidence(ctx: RequestContext, id: string, body: unknown): Promise<ControlEvidence> {
  return (await businessFetch<ControlEvidence>(ctx, `/security/controls/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: getSessionPolicy
export async function getSessionPolicy(ctx: RequestContext): Promise<SessionPolicy> {
  return (await businessFetch<SessionPolicy>(ctx, '/security/session-policy'))!;
}

// operationId: updateSessionPolicy
export async function updateSessionPolicy(ctx: RequestContext, body: unknown): Promise<SessionPolicy> {
  return (await businessFetch<SessionPolicy>(ctx, '/security/session-policy', { method: 'PUT', body }))!;
}

// operationId: getSupportAccessSetting
export async function getSupportAccessSetting(ctx: RequestContext): Promise<SupportAccessSetting> {
  return (await businessFetch<SupportAccessSetting>(ctx, '/security/support-access'))!;
}

// operationId: updateSupportAccessSetting
export async function updateSupportAccessSetting(ctx: RequestContext, body: unknown): Promise<SupportAccessSetting> {
  return (await businessFetch<SupportAccessSetting>(ctx, '/security/support-access', { method: 'PUT', body }))!;
}

// operationId: grantSupportAccess
export async function grantSupportAccess(ctx: RequestContext, body: unknown): Promise<SupportAccessEvent> {
  return (await businessFetch<SupportAccessEvent>(ctx, '/security/support-access/grants', { method: 'POST', body }))!;
}

// operationId: endSupportAccess
export async function endSupportAccess(ctx: RequestContext, id: string): Promise<SupportAccessEvent> {
  return (await businessFetch<SupportAccessEvent>(ctx, `/security/support-access/log/${pathSegment(id)}/end`, { method: 'POST' }))!;
}

// operationId: listSupportAccessEvents
export async function listSupportAccessEvents(ctx: RequestContext, query: PageQuery = {}): Promise<SupportAccessEventList> {
  return (await businessFetch<SupportAccessEventList>(ctx, `/security/support-access/log${qs(page(query))}`))!;
}

// ---------------------------------------------------------------------------------------------
// API clients and webhooks (admin.api_webhooks)
// ---------------------------------------------------------------------------------------------

// operationId: listApiClients
export async function listApiClients(ctx: RequestContext, query: PageQuery = {}): Promise<ApiClientList> {
  return (await businessFetch<ApiClientList>(ctx, `/api-clients${qs(page(query))}`))!;
}

/** The secret is returned once, here, and never stored; only its last four characters are kept as a hint. */
// operationId: createApiClient
export async function createApiClient(ctx: RequestContext, body: unknown): Promise<ApiClientCreated> {
  return (await businessFetch<ApiClientCreated>(ctx, '/api-clients', { method: 'POST', body }))!;
}

// operationId: revokeApiClient
export async function revokeApiClient(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<void>(ctx, `/api-clients/${pathSegment(id)}`, { method: 'DELETE' });
}

// operationId: rotateApiClient
export async function rotateApiClient(ctx: RequestContext, id: string): Promise<ApiClientCreated> {
  return (await businessFetch<ApiClientCreated>(ctx, `/api-clients/${pathSegment(id)}/rotate`, { method: 'POST' }))!;
}

// operationId: listWebhooks
export async function listWebhooks(ctx: RequestContext, query: PageQuery = {}): Promise<WebhookList> {
  return (await businessFetch<WebhookList>(ctx, `/webhooks${qs(page(query))}`))!;
}

// operationId: getWebhook
export async function getWebhook(ctx: RequestContext, id: string): Promise<Webhook> {
  return requireFound(await businessFetch<Webhook>(ctx, `/webhooks/${pathSegment(id)}`), 'Webhook');
}

// operationId: createWebhook
export async function createWebhook(ctx: RequestContext, body: unknown): Promise<Webhook> {
  return (await businessFetch<Webhook>(ctx, '/webhooks', { method: 'POST', body }))!;
}

// operationId: updateWebhook
export async function updateWebhook(ctx: RequestContext, id: string, body: unknown): Promise<Webhook> {
  return (await businessFetch<Webhook>(ctx, `/webhooks/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// operationId: deleteWebhook
export async function deleteWebhook(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<void>(ctx, `/webhooks/${pathSegment(id)}`, { method: 'DELETE' });
}

// operationId: listWebhookDeliveries
export async function listWebhookDeliveries(ctx: RequestContext, id: string, query: PageQuery = {}): Promise<WebhookDeliveryList> {
  return requireFound(await businessFetch<WebhookDeliveryList>(ctx, `/webhooks/${pathSegment(id)}/deliveries${qs(page(query))}`), 'Webhook');
}

/** The limits per scope (DG9). STORED, NOT ENFORCED: nothing in demo mode counts or refuses a request. */
// operationId: getRateLimits
export async function getRateLimits(ctx: RequestContext): Promise<ApiRateLimits> {
  return (await businessFetch<ApiRateLimits>(ctx, '/api-rate-limits'))!;
}

// operationId: updateRateLimits
export async function updateRateLimits(ctx: RequestContext, body: unknown): Promise<ApiRateLimits> {
  return (await businessFetch<ApiRateLimits>(ctx, '/api-rate-limits', { method: 'PUT', body }))!;
}

/** LABELLED STUB: no request is sent (Go scripts the answer and says so in the audit summary). */
// operationId: testWebhook
export async function testWebhook(ctx: RequestContext, id: string): Promise<WebhookTestResult> {
  return (await businessFetch<WebhookTestResult>(ctx, `/webhooks/${pathSegment(id)}/test`, { method: 'POST' }))!;
}

/** LABELLED STUB (DG10): nothing is sent; retries a failed delivery by script. */
// operationId: retryWebhookDelivery
export async function retryWebhookDelivery(ctx: RequestContext, id: string): Promise<WebhookDeliveryRetryResult> {
  return (await businessFetch<WebhookDeliveryRetryResult>(ctx, `/webhook-deliveries/${pathSegment(id)}/retry`, { method: 'POST' }))!;
}

// ---------------------------------------------------------------------------------------------
// Integrations (admin.data_sources)
// ---------------------------------------------------------------------------------------------

// operationId: listIntegrations
export async function listIntegrations(ctx: RequestContext, query: PageQuery = {}): Promise<IntegrationList> {
  return (await businessFetch<IntegrationList>(ctx, `/integrations${qs(page(query))}`))!;
}

// operationId: getIntegration
export async function getIntegration(ctx: RequestContext, id: string): Promise<Integration> {
  return requireFound(await businessFetch<Integration>(ctx, `/integrations/${pathSegment(id)}`), 'Integration');
}

// operationId: updateIntegration
export async function updateIntegration(ctx: RequestContext, id: string, body: unknown): Promise<Integration> {
  return (await businessFetch<Integration>(ctx, `/integrations/${pathSegment(id)}`, { method: 'PATCH', body }))!;
}

/** LABELLED STUB: nothing is sent; the answer is scripted from the stored health. */
// operationId: testIntegration
export async function testIntegration(ctx: RequestContext, id: string): Promise<IntegrationTestResult> {
  return (await businessFetch<IntegrationTestResult>(ctx, `/integrations/${pathSegment(id)}/test`, { method: 'POST' }))!;
}

// operationId: getIntegrationsHealth
export async function getIntegrationsHealth(ctx: RequestContext): Promise<IntegrationsHealth> {
  return (await businessFetch<IntegrationsHealth>(ctx, '/integrations/health'))!;
}

// ---------------------------------------------------------------------------------------------
// Localisation (admin.localization)
// ---------------------------------------------------------------------------------------------

// operationId: getLocalizationSettings
export async function getLocalizationSettings(ctx: RequestContext): Promise<LocalizationSettings> {
  return (await businessFetch<LocalizationSettings>(ctx, '/settings/localization'))!;
}

// operationId: updateLocalizationSettings
export async function updateLocalizationSettings(ctx: RequestContext, body: unknown): Promise<LocalizationSettings> {
  return (await businessFetch<LocalizationSettings>(ctx, '/settings/localization', { method: 'PUT', body }))!;
}
