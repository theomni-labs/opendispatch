// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Card, EmptyState } from '@opendispatch/ui';
import { CalendarCheck, CalendarOff, TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties } from 'react';
import { cx } from '@/components/opendispatch/cx';
import { IllustrativeLabel } from '@/components/opendispatch/IllustrativeLabel';
import { isolateLtr } from '@/components/opendispatch/isolateLtr';
import styles from './LeaveOutlook.module.css';
import { OutlookHorizon } from './OutlookHorizon';
import { OutlookTable, type OutlookTableRow } from './OutlookTable';
import type { LeaveOutlookView, OutlookCellView } from './outlook';
import type { OutlookStatus } from './outlook-types';

type VarStyle = CSSProperties & { [name: `--${string}`]: string | number };

// Leave outlook card, server.

type Translate = Awaited<ReturnType<typeof getTranslations<'ops.leave_planner'>>>;

const CELL_CLASS: Readonly<Record<OutlookStatus, string | undefined>> = {
  grant: styles.cellGrant,
  normal: undefined,
  restrict: styles.cellRestrict,
};

/** The week's reason in words. */
function reasonText(m: Translate, cell: OutlookCellView): string {
  const pct = isolateLtr(cell.changeLabel);
  const parts: string[] = [];
  const lead = cell.reasons.find((r) => r.effectLabel !== null);
  if (lead !== undefined) parts.push(m('out.reason.driver', { name: m(`out.driver.${lead.code}`), pct }));
  else if (Math.abs(cell.change) >= 0.02) parts.push(m('out.reason.plain', { pct }));
  for (const r of cell.reasons) {
    if (r.code === 'blackout') parts.push(m('out.reason.blackout', { label: r.label ?? '' }));
    if (r.code === 'leave_full') parts.push(m('out.reason.leave_full'));
  }
  return parts.length === 0 ? m('out.reason.none') : parts.join('; ');
}

export interface OutlookCardProps {
  readonly outlook: LeaveOutlookView;
}

export async function OutlookCard({ outlook }: OutlookCardProps) {
  const m = await getTranslations('ops.leave_planner');
  const wide = outlook.weeks === 13;
  const trackStyle: VarStyle = { '--lo-cols': outlook.weeks, '--lo-w': wide ? '76px' : '18px' };

  const body = () => {
    if (outlook.state === 'error') return <EmptyState compact icon={<TriangleAlert />} title={m('out.error')} />;
    if (outlook.state === 'empty') return <EmptyState compact icon={<CalendarOff />} title={m('out.noHistory')} />;
    const rows: OutlookTableRow[] = outlook.flagged.map((c) => ({
      id: `${c.zoneCode}:${c.key}`,
      week: c.week,
      startLabel: c.startLabel,
      zoneCode: c.zoneCode,
      status: c.status,
      changeLabel: c.changeLabel,
      room: c.room,
      sickLabel: c.sickLabel,
      reason: reasonText(m, c),
    }));
    return (
      <>
        <ul className={styles.legend}>
          {(['grant', 'normal', 'restrict'] as const).map((s) => (
            <li key={s} className={styles.legendItem}>
              <i className={cx(styles.swatch, s === 'grant' ? styles.swatchGrant : s === 'restrict' ? styles.swatchRestrict : styles.swatchNormal)} />
              <span>{m(`out.status.${s}`)}</span>
            </li>
          ))}
        </ul>
        <div className={styles.scroll}>
          <div className={styles.strip} role="group" aria-label={m('out.strip')}>
            <div className={styles.row}>
              <span className={styles.label} />
              <div className={styles.track} style={trackStyle}>
                {outlook.headers.map((h) => {
                  const spanStyle: VarStyle = { '--lo-span': h.span };
                  return (
                    <span key={h.label} className={styles.week} style={spanStyle} translate="no">
                      {h.label}
                    </span>
                  );
                })}
              </div>
            </div>
            {outlook.rows.map((row) => (
              <div key={row.zoneCode} className={styles.row}>
                <span className={styles.label} translate="no">
                  {row.zoneCode}
                </span>
                <div className={styles.track} style={trackStyle}>
                  {row.cells.map((c) => {
                    const tip = `${c.startLabel} · ${m(`out.status.${c.status}`)} · ${reasonText(m, c)}`;
                    return (
                      <span key={c.key} className={cx(styles.cell, CELL_CLASS[c.status])} title={tip} aria-label={`${row.zoneCode} ${tip}`} translate="no">
                        {wide ? c.changeLabel : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <OutlookTable key={outlook.weeks} rows={rows} empty={<EmptyState compact icon={<CalendarCheck />} title={m('out.empty')} />} />
      </>
    );
  };

  return (
    <Card padding="none">
      <div className={styles.head}>
        <div className={styles.title}>
          <h2 className={styles.titleText}>{m('out.title')}</h2>
          <IllustrativeLabel />
          {outlook.sickSource === null ? null : (
            <span title={m('out.sickTip')}>
              <Badge>{m(`out.sick.${outlook.sickSource}`)}</Badge>
            </span>
          )}
        </div>
        <OutlookHorizon value={outlook.weeks} />
      </div>
      {body()}
    </Card>
  );
}
