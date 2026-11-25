// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  ExclamationCircleFilled,
  InboxOutlined,
  InfoCircleFilled,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert as AntAlert, Empty, Progress as AntProgress } from 'antd';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { useFormat, useLabels } from '../provider';
import { cx as joinClasses, type Tone } from '../types';
import styles from './feedback.module.css';

/** Class names for Ant Design props, which take a string, not undefined. */
const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

/* ------------------------------------------------------------------ */
/* Alert                                                               */
/* ------------------------------------------------------------------ */

const ALERT_TYPE: Record<Tone, 'success' | 'info' | 'warning' | 'error'> = {
  neutral: 'info',
  accent: 'info',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

const ALERT_ICON: Record<Tone, ReactNode> = {
  neutral: <InfoCircleFilled aria-hidden="true" aria-label="" />,
  accent: <InfoCircleFilled aria-hidden="true" aria-label="" />,
  info: <InfoCircleFilled aria-hidden="true" aria-label="" />,
  success: <CheckCircleFilled aria-hidden="true" aria-label="" />,
  warning: <ExclamationCircleFilled aria-hidden="true" aria-label="" />,
  danger: <CloseCircleFilled aria-hidden="true" aria-label="" />,
};

export interface AlertProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  /** Shows a dismiss button. */
  onDismiss?: () => void;
  className?: string | undefined;
}

/** Ant Design's Alert. Warnings and errors are role="alert"; the rest are role="status", so they do not interrupt. */
export function Alert({ tone = 'info', title, children, icon, action, onDismiss, className }: AlertProps) {
  const label = useLabels();
  const urgent = tone === 'danger' || tone === 'warning';
  const dismiss = label('alert.dismiss');
  const hasTitle = title !== null && title !== undefined && title !== false && title !== '';
  return (
    <AntAlert
      role={urgent ? 'alert' : 'status'}
      type={ALERT_TYPE[tone]}
      showIcon
      icon={
        <span className={styles.alertIcon} aria-hidden="true">
          {icon ?? ALERT_ICON[tone]}
        </span>
      }
      message={hasTitle ? <span className={styles.alertTitle}>{title}</span> : children}
      description={hasTitle ? children : undefined}
      action={action ? <div className={styles.alertAction}>{action}</div> : undefined}
      {...(onDismiss
        ? {
            closable: { closeIcon: <CloseOutlined aria-label="" aria-hidden="true" />, 'aria-label': dismiss },
            onClose: () => onDismiss(),
          }
        : {})}
      className={cx(styles.alert, tone === 'neutral' && styles.neutral, className)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export type EmptyStateTone = 'default' | 'danger' | 'warning';
export type EmptyStateHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** Renders the title as a heading of this level; a paragraph otherwise. */
  headingLevel?: EmptyStateHeadingLevel;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  tone?: EmptyStateTone;
  className?: string | undefined;
}

/** Ant Design's Empty with a title, a description and an action. A danger empty state is role="alert". */
export function EmptyState({ icon, title, headingLevel, description, action, compact = false, tone = 'default', className }: EmptyStateProps) {
  const Title = headingLevel === undefined ? 'p' : (`h${String(headingLevel)}` as 'h2');
  const glyph = icon ?? (tone === 'default' ? <InboxOutlined aria-hidden="true" aria-label="" /> : <WarningOutlined aria-hidden="true" aria-label="" />);
  return (
    <Empty
      {...(tone === 'danger' ? { role: 'alert' } : {})}
      className={cx(styles.empty, compact && styles.compact, className)}
      image={
        <span className={cx(styles.emptyIcon, tone === 'danger' && styles.iconDanger, tone === 'warning' && styles.iconWarning)} aria-hidden="true">
          {glyph}
        </span>
      }
      description={
        <div className={styles.emptyText}>
          <Title className={styles.emptyTitle}>{title}</Title>
          {description ? <div className={styles.emptyDescription}>{description}</div> : null}
        </div>
      }
    >
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </Empty>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

function LoadingText() {
  const label = useLabels();
  return <span className={styles.srOnly}>{label('skeleton.loading')}</span>;
}

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: 'sm' | 'md' | 'lg' | 'full';
  /** Adds a visually hidden "Loading" for screen readers. */
  announce?: boolean;
  className?: string | undefined;
}

/** A shimmering placeholder block in the manner of Ant Design's Skeleton. */
export function Skeleton({ width, height = 12, radius = 'sm', announce = false, className }: SkeletonProps) {
  return (
    <>
      {announce ? <LoadingText /> : null}
      <span
        aria-hidden="true"
        className={cx(styles.skeleton, styles[`radius-${radius}`], className)}
        style={{ inlineSize: width ?? '100%', blockSize: height }}
      />
    </>
  );
}

export interface SkeletonTextProps {
  lines?: number;
  announce?: boolean;
  className?: string | undefined;
}

const LINE_WIDTHS = ['100%', '92%', '96%', '88%'];

/** Lines of placeholder text; the last line is shorter. */
export function SkeletonText({ lines = 3, announce = false, className }: SkeletonTextProps) {
  const rows = Array.from({ length: lines }, (_, index) =>
    index === lines - 1 && lines > 1 ? '60%' : (LINE_WIDTHS[index % LINE_WIDTHS.length] ?? '100%'),
  );
  return (
    <>
      {announce ? <LoadingText /> : null}
      <span className={cx(styles.lines, className)} aria-hidden="true">
        {rows.map((width, index) => (
          <Skeleton key={index} height={10} width={width} />
        ))}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

const TONE_FILL: Record<Tone, string> = {
  neutral: 'var(--od-color-neutral)',
  accent: 'var(--od-color-primary)',
  success: 'var(--od-color-success)',
  warning: 'var(--od-color-warning)',
  danger: 'var(--od-color-error)',
  info: 'var(--od-color-info)',
};

export interface ProgressProps {
  value: number;
  max?: number;
  tone?: Tone;
  size?: 'sm' | 'md';
  label?: ReactNode;
  showValue?: boolean;
  /** The text read out and shown for the value. Default: the percentage. */
  valueLabel?: string;
  className?: string | undefined;
}

/** Ant Design's line Progress with a label row; the bar is a progressbar named by the label. */
export function Progress({ value, max = 100, tone = 'accent', size = 'md', label, showValue = false, valueLabel, className }: ProgressProps) {
  const { pct } = useFormat();
  const labelId = useId();
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const text = valueLabel ?? pct(Math.round(percent));
  return (
    <div className={cx(styles.progress, className)}>
      {label || showValue ? (
        <div className={styles.progressHeader}>
          {label ? (
            <span id={labelId} className={styles.progressLabel}>
              {label}
            </span>
          ) : (
            <span />
          )}
          {showValue ? <span className={styles.progressValue}>{text}</span> : null}
        </div>
      ) : null}
      <AntProgress
        percent={percent}
        showInfo={false}
        size={size === 'sm' ? 'small' : 'default'}
        strokeColor={TONE_FILL[tone]}
        className={cx(styles.bar)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(max, value))}
        aria-valuetext={text}
        {...(label ? { 'aria-labelledby': labelId } : {})}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SegmentBar                                                          */
/* ------------------------------------------------------------------ */

export interface SegmentBarSegment {
  value: number;
  tone?: Tone;
  /** Any CSS colour, such as a token: var(--od-chart-1). */
  color?: string;
  label: string;
}

export interface SegmentBarProps {
  segments: SegmentBarSegment[];
  height?: number;
  showLegend?: boolean;
  className?: string | undefined;
}

const CHART_COLORS = ['var(--od-chart-1)', 'var(--od-chart-2)', 'var(--od-chart-3)', 'var(--od-chart-4)', 'var(--od-chart-5)', 'var(--od-chart-6)'];

function segmentColor(segment: SegmentBarSegment, index: number): string {
  if (segment.color) return segment.color;
  if (segment.tone) return TONE_FILL[segment.tone];
  return CHART_COLORS[index % CHART_COLORS.length] ?? 'var(--od-chart-1)';
}

/** One bar split into shares; read out as a list of labels and percentages. */
export function SegmentBar({ segments, height = 8, showLegend = false, className }: SegmentBarProps) {
  const { locale, pct } = useFormat();
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const share = (value: number) => pct(Math.round(total > 0 ? (Math.max(0, value) / total) * 100 : 0));
  const summary = new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }).format(
    segments.map((segment) => `${segment.label} ${share(segment.value)}`),
  );
  return (
    <div className={cx(styles.segmentWrap, className)}>
      <div className={styles.segments} style={{ blockSize: height }} role="img" aria-label={summary}>
        {total === 0 ? <div className={styles.segmentEmpty} /> : null}
        {segments.map((segment, index) =>
          segment.value > 0 ? (
            <div
              key={`${segment.label}-${String(index)}`}
              className={styles.segment}
              style={{ flexGrow: segment.value, background: segmentColor(segment, index) } as CSSProperties}
              title={`${segment.label}: ${share(segment.value)}`}
            />
          ) : null,
        )}
      </div>
      {showLegend ? (
        <ul className={styles.legend}>
          {segments.map((segment, index) => (
            <li key={`${segment.label}-${String(index)}`} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: segmentColor(segment, index) }} aria-hidden="true" />
              <span>{segment.label}</span>
              <span className={styles.legendValue}>{share(segment.value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
