// SPDX-License-Identifier: AGPL-3.0-only
// The weather row's source

import type { WorkingAssumptions } from '@/lib/types';
import type { FeedHealth, WeatherSource } from './types';

/** The weather the forecaster reads, or null for none. */
export function weatherSourceOf(weather: WorkingAssumptions['weather'] | null): WeatherSource | null {
  if (weather === null || weather.source === 'none') return null;
  return weather.source === 'feed' ? { kind: 'feed' } : { kind: 'stored', to: weather.to ?? null, source: weather.attribution ?? null };
}

/** An Off weather row with a source is not off. */
export function weatherHealth(health: FeedHealth, source: WeatherSource | null): FeedHealth {
  if (health !== 'disabled' || source === null) return health;
  return source.kind === 'stored' ? 'healthy' : 'unknown';
}
