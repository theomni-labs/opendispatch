'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, SegmentedControl, SegmentBar, StatusPill, Tooltip, useFormat } from '@opendispatch/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import type { SplitView } from './view';
import styles from './ForecastExplorer.module.css';

// Field or remote (#fx-split-title): split bar,
// active rules or a draft preview. "With draft"
// needs Classification Rules access too
// (canPreviewDraft; the screen states rule: no dead control).

export interface RulesPanelProps {
  readonly split: SplitView;
  readonly rules: 'active' | 'draft';
}

export function RulesPanel({ split, rules }: RulesPanelProps) {
  const m = useTranslations('ops.forecast_explorer');
  const format = useFormat();
  const url = useUrlState();

  return (
    <>
      {split.canPreviewDraft ? (
        <div className={styles.chips}>
          <SegmentedControl
            size="sm"
            ariaLabel={m('rules.label')}
            value={rules}
            options={[
              { value: 'active', label: m('rules.active') },
              { value: 'draft', label: m('rules.draft') },
            ]}
            onChange={(value) => url.update({ rules: value === 'active' ? null : value })}
          />
        </div>
      ) : (
        // Nothing to toggle: role can't preview a draft
        // rule.
        <div className={styles.chips}>
          <Badge>{m('rules.active')}</Badge>
        </div>
      )}

      <SegmentBar
        segments={[
          { value: split.fieldExpected, color: 'var(--od-chart-1)', label: m('view.field') },
          { value: split.remoteExpected, color: 'var(--od-chart-3)', label: m('view.remote') },
        ]}
      />
      <ul className={styles.legend}>
        <li className={styles.legendRow}>
          <span className={styles.legendKey}>
            <i className={styles.swatch} style={{ background: 'var(--od-chart-1)' }} aria-hidden="true" />
            {m('view.field')}
          </span>
          <span translate="no">
            {format.int(split.fieldExpected)} · {format.pct(split.fieldShare * 100)}
          </span>
        </li>
        <li className={styles.legendRow}>
          <span className={styles.legendKey}>
            <i className={styles.swatch} style={{ background: 'var(--od-chart-3)' }} aria-hidden="true" />
            <span>
              {m('view.remote')} <span className="t-caption">{m('inferred')}</span>
            </span>
          </span>
          <span translate="no">
            {format.int(split.remoteExpected)} · {format.pct((1 - split.fieldShare) * 100)}
          </span>
        </li>
      </ul>

      <hr className={styles.divider} />
      <div className={styles.chips}>
        <Badge>
          {m('ruleset')} <span translate="no">{split.ruleSetVersion}</span>
        </Badge>
        {split.canPreviewDraft ? (
          <>
            <StatusPill status={m('rules.nActive', { n: split.activeCount })} tone="success" size="sm" />
            <StatusPill status={m('rules.nDraft', { n: split.draftCount })} tone={rules === 'draft' ? 'warning' : 'neutral'} size="sm" />
          </>
        ) : null}
      </div>
      {rules === 'draft' && split.previewRuleCode !== null ? (
        <Tooltip content={m('draft.note')}>
          <span className={styles.legendRow}>
            <TriangleAlert aria-hidden="true" size={14} />
            <span translate="no">{split.previewRuleCode}</span> <span>{m('draft.note')}</span>
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}
