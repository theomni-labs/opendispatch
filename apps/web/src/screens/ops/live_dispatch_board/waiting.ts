// SPDX-License-Identifier: AGPL-3.0-only
// Waiting spots: advisory moves

import { time } from '@opendispatch/ui/format';
import type { MapLink, MapPin } from '@/components/opendispatch/MapView';
import type { WaitingSpots } from '@/lib/types';
import type { WaitingSpotsView } from './types';

type Spot = WaitingSpots['items'][number];

/** Where an agent is now, when the board knows. */
export type PositionOf = (agentId: string) => readonly [lat: number, lon: number] | undefined;

/** The suggestion list, shortest drive first. */
export function waitingSpotsView(spots: WaitingSpots, nameOf: (agentId: string) => string, zoneOf: (zoneId: string) => string): WaitingSpotsView {
  const rows = spots.items
    .map((w) => ({ agentId: w.agent_id, name: nameOf(w.agent_id), zoneCode: zoneOf(w.zone_id), moveKm: Math.round(w.move_km * 10) / 10, reason: w.reason_code }))
    .sort((a, b) => a.moveKm - b.moveKm || a.name.localeCompare(b.name));
  return { enabled: spots.enabled, illustrative: spots.illustrative, generatedAt: spots.generated_at === null ? null : time(spots.generated_at), rows };
}

/** A spot pin and an arrow from the agent, for agents on the map. */
export function spotMarks(spots: readonly Spot[], positionOf: PositionOf, nameOf: (agentId: string) => string): { pins: MapPin[]; links: MapLink[] } {
  const pins: MapPin[] = [];
  const links: MapLink[] = [];
  for (const w of spots) {
    const from = positionOf(w.agent_id);
    if (from === undefined) continue;
    pins.push({ id: `spot:${w.agent_id}`, lat: w.latitude, lon: w.longitude, kind: 'spot', label: nameOf(w.agent_id) });
    links.push({ from, to: [w.latitude, w.longitude], kind: 'suggestion' });
  }
  return { pins, links };
}
