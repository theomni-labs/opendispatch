// SPDX-License-Identifier: AGPL-3.0-only
import styles from './LeavePlanner.module.css';

// Required vs planned, one scale

const PAD = 3;

export interface EffectSparkProps {
  readonly required: readonly number[];
  readonly planned: readonly number[];
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
}

/** A single day draws as a flat line. */
function widen(values: readonly number[]): readonly number[] {
  return values.length === 1 ? [values[0] as number, values[0] as number] : values;
}

export function sparkPaths(required: readonly number[], planned: readonly number[], width: number, height: number): { readonly required: string; readonly planned: string } | null {
  if (required.length === 0 || required.length !== planned.length) return null;
  const req = widen(required);
  const plan = widen(planned);
  const all = [...req, ...plan];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const path = (values: readonly number[]) =>
    values
      .map((v, i) => {
        const x = PAD + (i / (values.length - 1)) * (width - PAD * 2);
        const y = PAD + ((hi - v) / span) * (height - PAD * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join('');
  return { required: path(req), planned: path(plan) };
}

export function EffectSpark({ required, planned, label, width = 64, height = 24 }: EffectSparkProps) {
  const paths = sparkPaths(required, planned, width, height);
  if (paths === null) return null;
  return (
    <svg className={styles.spark} width={width} height={height} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label={label}>
      <path d={paths.required} fill="none" stroke="var(--od-chart-6)" strokeWidth={1.5} strokeLinecap="round" strokeDasharray="3 2" />
      <path d={paths.planned} fill="none" stroke="var(--od-chart-1)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
