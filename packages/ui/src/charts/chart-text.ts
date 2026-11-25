// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useMemo } from 'react';
import { num } from '../format';
import { useLabels, useLocale } from '../provider';

/** Axis numbers in short form: 950, 1.2K, 3.4M (the K and M come from the labels, so Arabic can change them). */
export function useCompactFormat(): (value: number) => string {
  const locale = useLocale();
  const label = useLabels();
  return useMemo(
    () => (value: number) => {
      const size = Math.abs(value);
      if (size >= 1_000_000) return label('chart.compactMillion', { n: num(value / 1_000_000, undefined, locale) });
      if (size >= 1_000) return label('chart.compactThousand', { n: num(value / 1_000, undefined, locale) });
      return num(value, undefined, locale);
    },
    [locale, label],
  );
}

/** Joins names inside a sentence with the language's list separator. */
export function useListJoin(): (items: readonly string[]) => string {
  const label = useLabels();
  return useMemo(() => {
    const separator = label('chart.listSeparator');
    return (items: readonly string[]) => items.join(separator);
  }, [label]);
}

/** The accessible name: the title, then the generated summary. */
export function useTitled(): (title: string | undefined, summary: string) => string {
  const label = useLabels();
  return useMemo(() => (title, summary) => (title ? label('chart.titled', { title, summary }) : summary), [label]);
}

/** The series colour when none is given: the chart palette in order. */
export function paletteColor(index: number): string {
  return `var(--od-chart-${String((index % 6) + 1)})`;
}
