// SPDX-License-Identifier: AGPL-3.0-only
import { date } from '@opendispatch/ui/format';
import type { WeatherSource } from './types';
import styles from './SystemHealth.module.css';

export interface WeatherSubProps {
  readonly source: WeatherSource;
  readonly label: (key: 'wx.feed' | 'wx.stored', values?: { readonly date: string }) => string;
  readonly locale: 'en' | 'ar';
}

/** The weather row's sub-line: stored date and source, or feed. */
export function WeatherSub({ source, label, locale }: WeatherSubProps) {
  if (source.kind === 'feed') return <span className={styles.cellSub}>{label('wx.feed')}</span>;
  return (
    <span className={styles.cellSub}>
      {source.to === null ? null : label('wx.stored', { date: date(source.to, { locale }) })}
      {source.to !== null && source.source !== null ? ' · ' : null}
      {source.source === null ? null : (
        <bdi dir="ltr" translate="no">
          {source.source}
        </bdi>
      )}
    </span>
  );
}
