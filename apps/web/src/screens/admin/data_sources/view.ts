// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Data Sources and Integrations screen: reads through lib/data with the request context and returns
// plain data. Not a Server Component and not an action: `Screen.tsx` calls it, the tests call it directly.
//
// Reads: listIntegrations (the feeds), getFallbackState and listZoneStages (they need view on the Live Dispatch Board, which the
// Administrator has), getSettingsSnapshot (the fallback timeout and the decision deadline), listZones and listCities (names of
// the zones), listUserDisplayNames (who set a stage).

import type { RequestContext } from '@/lib/data/guard';
import { getFallbackState, listZoneStages } from '@/lib/data/dispatch';
import { listCities, listZones } from '@/lib/data/locations';
import { getSettingsSnapshot } from '@/lib/data/settings';
import { listIntegrations } from '@/lib/data/system';
import { customerText } from '@/lib/data/wording';
import { listUserDisplayNames } from '@/lib/data/users';
import { ForbiddenError } from '@/lib/data/errors';
import type { City, DataSource, Zone } from '@/lib/types';
import type { FallbackView, FeedKind, FeedView, SourcesView, ZoneRow } from './types';

const PAGE = 200;

/** The short code of a zone (`RD-C`), which the fixtures keep in `extra.code`; the name when a zone has none. */
export function zoneCode(zone: Zone): string {
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
}

const FEED_KINDS: readonly string[] = ['case_feed', 'agent_feed', 'assignment_channel', 'weather_feed', 'routing_feed'];
const feedKind = (kind: string): FeedKind => (FEED_KINDS.includes(kind) ? (kind as FeedKind) : 'other');

export async function loadSourcesView(ctx: RequestContext): Promise<SourcesView> {
  const integrations = (await listIntegrations(ctx, { limit: PAGE })).items;
  const fallback = await getFallbackState(ctx);
  const stages = (await listZoneStages(ctx, { limit: PAGE })).items;
  const snapshot = await getSettingsSnapshot(ctx);
  const zones = (await listZones(ctx, { limit: PAGE })).items;
  const cities = (await listCities(ctx, { limit: PAGE })).items;

  const cityName = new Map<string, string>(cities.map((c: City) => [c.id, c.name_en]));
  const zoneById = new Map<string, Zone>(zones.map((z) => [z.id, z]));
  const setters = [...new Set(stages.flatMap((s) => (s.updated_by === null || s.updated_by === undefined ? [] : [s.updated_by])))];
  const names = new Map<string, string>();
  if (setters.length > 0) {
    try {
      for (const person of (await listUserDisplayNames(ctx, setters)).items) names.set(person.id, person.display_name);
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error;
    }
  }

  const feeds: FeedView[] = integrations.map((i) => ({
    id: i.id,
    kind: feedKind(i.kind),
    name: customerText(i.name_en),
    direction: i.direction,
    enabled: i.is_enabled,
    simulated: i.is_enabled && i.data_source !== 'LIVE',
    health: i.health,
    lastSuccessAt: i.last_success_at ?? null,
    lastErrorAt: i.last_error_at ?? null,
    lastError: i.last_error_message ?? null,
    timeoutSeconds: i.fallback_timeout_seconds ?? null,
  }));

  const rows: ZoneRow[] = stages.flatMap((stage) => {
    const zone = zoneById.get(stage.zone_id);
    if (zone === undefined) return [];
    return [
      {
        id: zone.id,
        code: zoneCode(zone),
        name: zone.name_en,
        city: cityName.get(zone.city_id) ?? '',
        stage: stage.stage,
        updatedAt: stage.updated_at,
        updatedBy: stage.updated_by === null || stage.updated_by === undefined ? null : (names.get(stage.updated_by) ?? null),
      },
    ];
  });

  const fallbackView: FallbackView = {
    state: fallback.state,
    reason: fallback.reason,
    since: fallback.since,
    lastSignal: fallback.last_signal ?? null,
    lastSignalAt: fallback.last_signal_at ?? null,
    assignedCount: fallback.fallback_assigned_count,
  };
  const sources = [...new Set<DataSource>([...integrations.map((i) => i.data_source), ...stages.map((s) => s.data_source)])];
  const count = (predicate: (feed: FeedView) => boolean) => feeds.filter(predicate).length;

  return {
    feeds,
    zones: rows,
    fallback: fallbackView,
    timeoutSeconds: snapshot.fallback_timeout_seconds,
    deadlineMs: snapshot.decision_deadline_ms ?? 2000,
    suggestions: {
      reposition: snapshot.dispatch_reposition ?? false,
      maxMoveKm: snapshot.dispatch_reposition_max_move_km ?? 5,
      prayerPenalty: snapshot.dispatch_prayer_penalty ?? false,
    },
    sources,
    counts: {
      healthy: count((f) => f.enabled && f.health === 'healthy'),
      degraded: count((f) => f.enabled && (f.health === 'degraded' || f.health === 'down')),
      off: count((f) => !f.enabled),
    },
  };
}
