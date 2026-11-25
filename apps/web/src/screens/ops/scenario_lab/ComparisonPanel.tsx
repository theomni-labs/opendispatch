// SPDX-License-Identifier: AGPL-3.0-only
import { Alert, Card, StatusPill } from '@opendispatch/ui';
import { ArrowDownRight, ArrowUpRight, Equal } from 'lucide-react';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { Reading, type ReadingItem } from '@/components/opendispatch/Reading';
import { signed } from './changes';
import { ComparisonHeat } from './ComparisonHeat';
import styles from './ScenarioLab.module.css';
import type { ComparisonView } from './view';

// Before and after (#sc2-res), sync RSC

/** next-intl's resolved translator shape. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface ComparisonPanelProps {
  readonly m: Translate;
  readonly comparison: ComparisonView | undefined;
}

export function ComparisonPanel({ m, comparison }: ComparisonPanelProps) {
  if (comparison === undefined) {
    return (
      <Card padding="lg">
        <h2 className={styles.cardTitle}>{m('res.title')}</h2>
        <p className={styles.readingPrompt}>{m('res.needsSave')}</p>
      </Card>
    );
  }

  const { zoneRows, heat, reading, stale, engine, unsupported } = comparison;

  const readingItems: ReadingItem[] | undefined =
    reading === undefined
      ? undefined
      : [
          { label: m('read.fromAssignment'), value: reading.fromAssignmentPct, primary: reading.primaryIsAssignment, illustrative: true },
          { label: m('read.fromRegistration'), value: reading.fromRegistrationPct, primary: !reading.primaryIsAssignment, illustrative: true },
        ].sort((a, b) => Number(b.primary) - Number(a.primary));

  return (
    <Card padding="lg">
      <div className={styles.comparisonHead}>
        <div className={styles.comparisonTitleRow}>
          <h2 className={styles.cardTitle}>{m('res.title')}</h2>
          <IllustrativeLabel />
          {stale ? <StatusPill status={m('stale')} tone="warning" size="sm" /> : null}
          {engine === null ? null : (
            <span className={styles.lastRun} translate="no">
              {engine.model} · {m('engine')} {engine.version}
            </span>
          )}
        </div>
        <ul className={styles.legend}>
          <li className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.swatchGap}`} aria-hidden="true" />
            <span>{m('gap')}</span>
          </li>
          <li className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.swatchBalanced}`} aria-hidden="true" />
            <span>{m('balanced')}</span>
          </li>
          <li className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.swatchSurplus}`} aria-hidden="true" />
            <span>{m('surplus')}</span>
          </li>
        </ul>
      </div>

      <div className={styles.comparisonBody}>
        {unsupported.length === 0 ? null : (
          <Alert tone="warning" title={m('unsup.title')}>
            {m('unsup.body', { list: unsupported.map((part) => m(`chg.${part.kind}`, { n: signed(part.n) })).join(', ') })}
          </Alert>
        )}
        <div className={styles.zoneRows}>
          <div className={`${styles.zoneRow} ${styles.zoneRowHead}`}>
            <span />
            <span className={styles.span2}>{m('before')}</span>
            <span className={styles.span2}>{m('after')}</span>
            <span className={styles.num}>{m('gapDelta')}</span>
          </div>
          {zoneRows.map((row) => {
            const total = row.before.gap + row.before.balanced + row.before.surplus || 1;
            const totalAfter = row.after.gap + row.after.balanced + row.after.surplus || 1;
            const tone = row.gapDelta < 0 ? styles.deltaGood : row.gapDelta > 0 ? styles.deltaBad : styles.deltaFlat;
            const Icon = row.gapDelta < 0 ? ArrowDownRight : row.gapDelta > 0 ? ArrowUpRight : Equal;
            return (
              <div key={row.zoneId} className={styles.zoneRow}>
                <span translate="no">{row.code}</span>
                <span className={styles.segBar} role="img" aria-label={m('before')}>
                  <span className={`${styles.seg} ${styles.swatchGap}`} style={{ flexGrow: row.before.gap }} />
                  <span className={`${styles.seg} ${styles.swatchBalanced}`} style={{ flexGrow: row.before.balanced }} />
                  <span className={`${styles.seg} ${styles.swatchSurplus}`} style={{ flexGrow: row.before.surplus }} />
                  <span className={styles.seg} style={{ flexGrow: Math.max(0, total - row.before.gap - row.before.balanced - row.before.surplus) }} />
                </span>
                <span className={styles.num}>{row.before.gap}</span>
                <span className={styles.segBar} role="img" aria-label={m('after')}>
                  <span className={`${styles.seg} ${styles.swatchGap}`} style={{ flexGrow: row.after.gap }} />
                  <span className={`${styles.seg} ${styles.swatchBalanced}`} style={{ flexGrow: row.after.balanced }} />
                  <span className={`${styles.seg} ${styles.swatchSurplus}`} style={{ flexGrow: row.after.surplus }} />
                  <span className={styles.seg} style={{ flexGrow: Math.max(0, totalAfter - row.after.gap - row.after.balanced - row.after.surplus) }} />
                </span>
                <span className={styles.num}>{row.after.gap}</span>
                <span className={`${styles.delta} ${tone}`}>
                  <Icon aria-hidden="true" size={14} />
                  <bdi dir="ltr" translate="no">
                    {signed(row.gapDelta)}
                  </bdi>
                </span>
              </div>
            );
          })}
        </div>

        {readingItems === undefined ? (
          <p className={styles.readingPrompt}>{m('read.needsRun')}</p>
        ) : (
          <Reading items={readingItems} />
        )}

        <div>
          <h3 className={styles.heatTitle}>{m('heat.title')}</h3>
          <ComparisonHeat heat={heat} label={m('heat.title')} />
        </div>
      </div>
    </Card>
  );
}
