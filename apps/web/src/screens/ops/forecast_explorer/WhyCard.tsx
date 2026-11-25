// SPDX-License-Identifier: AGPL-3.0-only
import { Card, EmptyState, Skeleton } from '@opendispatch/ui';
import { date as formatDate, num, time as formatTime, weekday } from '@opendispatch/ui/format';
import { Info, TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Qualifier } from '@/components/opendispatch/Qualifier';
import type { RequestContext } from '@/lib/data/guard';
import { loadWhy } from './insight';
import styles from './WhyCard.module.css';

export interface WhyCardProps {
  readonly ctx: RequestContext;
  readonly zoneId: string;
  readonly day: string;
  readonly time: number;
  readonly locale: 'en' | 'ar';
  /** The interval's expected over the day mean. */
  readonly timeFactor: number;
  /** Sub-zone code and its share of the zone. */
  readonly sub: { readonly code: string; readonly expected: number } | null;
}

function Bar({ value }: { readonly value: number }) {
  const width = Math.min(50, (Math.abs(Math.log(Math.max(value, 0.01))) / Math.log(2)) * 50);
  return (
    <span className={styles.bar} aria-hidden="true">
      <span className={value >= 1 ? styles.up : styles.down} style={{ inlineSize: `${width.toFixed(1)}%` }} />
    </span>
  );
}

function Row({ label, value, bar, total = false }: { readonly label: React.ReactNode; readonly value: string; readonly bar?: number | undefined; readonly total?: boolean }) {
  return (
    <div className={total ? `${styles.row} ${styles.total}` : styles.row}>
      <span className={styles.label}>{label}</span>
      {bar === undefined ? <span /> : <Bar value={bar} />}
      <span className={styles.value} translate="no">
        {value}
      </span>
    </div>
  );
}

function Frame({ title, meta, children }: { readonly title: string; readonly meta?: string | undefined; readonly children: React.ReactNode }) {
  return (
    <Card padding="lg">
      <div className={styles.stack}>
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <h2 className="t-heading-s">{title}</h2>
            <IllustrativeLabel />
          </div>
          {meta === undefined ? null : (
            <span className="t-caption" translate="no">
              {meta}
            </span>
          )}
        </div>
        {children}
      </div>
    </Card>
  );
}

export async function WhyCardSkeleton() {
  const m = await getTranslations('ops.forecast_explorer');
  return (
    <Frame title={m('why.title')}>
      <div className={styles.stack} aria-busy="true">
        <Skeleton height={20} announce />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </div>
    </Frame>
  );
}

// "Why this forecast": base x drivers = the day.
export async function WhyCard({ ctx, zoneId, day, time, locale, timeFactor, sub }: WhyCardProps) {
  const m = await getTranslations('ops.forecast_explorer');
  const why = await loadWhy(ctx, zoneId, day);
  if (why.status !== 'filled') {
    const error = why.status === 'error';
    return (
      <Frame title={m('why.title')}>
        <EmptyState compact tone={error ? 'danger' : 'default'} icon={error ? <TriangleAlert /> : <Info />} title={m(error ? 'why.error' : 'why.empty')} />
      </Frame>
    );
  }
  const meta =
    why.trainingStart !== undefined && why.trainingEnd !== undefined
      ? m('why.model', { v: why.model, from: formatDate(why.trainingStart, { locale }), to: formatDate(why.trainingEnd, { locale }) })
      : why.model;
  const cases = (n: number) => m('why.cases', { n: num(Math.round(n), 0, locale) });
  const labelOf = (driver: string): React.ReactNode => {
    if (driver === 'weekday') return weekday(day, { locale, length: 'long', timeZone: 'Asia/Riyadh' });
    const key = `why.d.${driver}`;
    return m.has(key) ? m(key) : <bdi translate="no">{driver}</bdi>;
  };
  return (
    <Frame title={m('why.title')} meta={meta}>
      <div className={styles.rows}>
        <Row label={<b>{m('why.base')}</b>} value={cases(why.base)} />
        {why.drivers.map((d, i) => (
          <Row
            key={`${d.driver}-${String(i)}`}
            label={
              <>
                {labelOf(d.driver)}
                {d.unknown ? (
                  <>
                    {' '}
                    <Qualifier>{m('why.unknown')}</Qualifier>
                  </>
                ) : null}
              </>
            }
            bar={d.multiplier}
            value={`×${num(d.multiplier, 2, locale)}`}
          />
        ))}
        <Row total label={<b>{m('why.total')}</b>} value={cases(why.expected)} />
        <Row label={m('why.at', { time: formatTime(time * 15) })} bar={timeFactor} value={`×${num(timeFactor, 2, locale)}`} />
        {sub === null || why.expected <= 0 ? null : (
          <Row label={m('why.sub', { code: sub.code.slice(-2) })} value={m('why.subv', { pct: `${num((sub.expected / why.expected) * 100, 1, locale)}%` })} />
        )}
      </div>
    </Frame>
  );
}
