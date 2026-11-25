// SPDX-License-Identifier: AGPL-3.0-only
import { useFormat } from '@opendispatch/ui';
import { useLocale } from 'next-intl';

/** `13 Sept 2026, 06:00`; in Arabic each part is isolated and joined by the Arabic comma. */
export function useDateTime(): (iso: string) => string {
  const format = useFormat();
  const arabic = useLocale() === 'ar';
  return (iso) => (arabic ? `⁨${format.date(iso)}⁩، ⁨${format.time(iso)}⁩` : `${format.date(iso)}, ${format.time(iso)}`);
}
