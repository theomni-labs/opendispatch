// SPDX-License-Identifier: AGPL-3.0-only
import type { ScreenProps } from '@/screens/types';
import type { AccuracyZoneName } from './accuracy';
import { AccuracyCard } from './AccuracyCard';
import { loadAccuracyCard } from './accuracyView';

// Server Component: streams in under Suspense.

export interface AccuracySectionProps {
  readonly ctx: ScreenProps['ctx'];
  readonly zoneId: string;
  readonly past: string | undefined;
  readonly zones: readonly AccuracyZoneName[];
  readonly locale: 'en' | 'ar';
}

export async function AccuracySection({ ctx, zoneId, past, zones, locale }: AccuracySectionProps) {
  const data = await loadAccuracyCard(ctx, { zoneId, past }, zones, locale);
  return <AccuracyCard data={data} />;
}
