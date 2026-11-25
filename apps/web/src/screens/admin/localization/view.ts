// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Localization screen: reads through lib/data with the request context and returns plain data.
// Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: getLocalizationSettings, and the eight lists whose records have an Arabic name (listCities, listZones, listSubZones,
// listStandbyPoints, listCaseTypes, listShiftPatterns, listBreakRules, listHolidays: platform.records), counted for the coverage table and
// sampled for the fallback preview. Nothing here changes how a page is drawn: the settings are stored and audited, not applied.

import type { RequestContext } from '@/lib/data/guard';
import { listCaseTypes } from '@/lib/data/cases';
import { customerText } from '@/lib/data/wording';
import { listCities, listStandbyPoints, listSubZones, listZones } from '@/lib/data/locations';
import { getLocalizationSettings } from '@/lib/data/system';
import { listBreakRules, listHolidays, listShiftPatterns } from '@/lib/data/time';
import type { DataSource, PageInfo } from '@/lib/types';
import type { CoverageKind, CoverageRow, FallbackSample, Settings } from './types';

export interface LocalizationView {
  readonly sources: readonly DataSource[];
  readonly settings: Settings;
  readonly coverage: readonly CoverageRow[];
  /** A zone, a case type and a holiday: the fallback preview shows their names. */
  readonly samples: readonly FallbackSample[];
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

interface Named {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar?: string | null | undefined;
}

const hasArabic = (record: Named): boolean => typeof record.name_ar === 'string' && record.name_ar.trim() !== '';
const coverageOf = (kind: CoverageKind, records: readonly Named[]): CoverageRow => ({ kind, records: records.length, arabic: records.filter(hasArabic).length });
const sampleOf = (record: Named | undefined): FallbackSample[] => (record === undefined ? [] : [{ id: record.id, english: customerText(record.name_en), arabic: hasArabic(record) ? (record.name_ar as string) : null }]);

export async function loadLocalizationView(ctx: RequestContext): Promise<LocalizationView> {
  const stored = await getLocalizationSettings(ctx);
  const cities = await listAll((cursor) => listCities(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const zones = await listAll((cursor) => listZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const subZones = await listAll((cursor) => listSubZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const standby = await listAll((cursor) => listStandbyPoints(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const caseTypes = await listAll((cursor) => listCaseTypes(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const shifts = await listAll((cursor) => listShiftPatterns(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const breaks = await listAll((cursor) => listBreakRules(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const holidays = await listAll((cursor) => listHolidays(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));

  return {
    sources: [
      ...new Set(
        [cities, zones, subZones, standby, caseTypes, shifts, breaks, holidays].flatMap((list) => list.map((record) => record.data_source)),
      ),
    ],
    settings: {
      default_locale: stored.default_locale,
      digit_system: stored.digit_system,
      primary_calendar: stored.primary_calendar,
      show_secondary_calendar: stored.show_secondary_calendar,
      first_day_of_week: stored.first_day_of_week,
    },
    coverage: [
      coverageOf('cities', cities),
      coverageOf('zones', zones),
      coverageOf('subzones', subZones),
      coverageOf('standby', standby),
      coverageOf('casetypes', caseTypes),
      coverageOf('shifts', shifts),
      coverageOf('breaks', breaks),
      coverageOf('holidays', holidays),
    ],
    samples: [...sampleOf(zones.find((z) => !hasArabic(z)) ?? zones[0]), ...sampleOf(caseTypes.find((c) => !hasArabic(c)) ?? caseTypes[0]), ...sampleOf(holidays.find(hasArabic) ?? holidays[0])],
  };
}
