// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CheckOutlined } from '@ant-design/icons';
import { Steps, Timeline as AntTimeline } from 'antd';
import type { ReactNode } from 'react';
import { useLabels } from '../provider';
import { cx as joinClasses, type Tone } from '../types';
import { Avatar } from './avatar';
import styles from './timeline.module.css';

const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

const DOT_COLOR: Record<Tone, string> = {
  neutral: 'var(--od-color-neutral)',
  accent: 'var(--od-color-primary)',
  info: 'var(--od-color-info)',
  success: 'var(--od-color-success)',
  warning: 'var(--od-color-warning)',
  danger: 'var(--od-color-error)',
};

export interface TimelineItem {
  id?: string;
  title: ReactNode;
  /** Already formatted. */
  time?: string;
  description?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  actor?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
  dense?: boolean;
  className?: string | undefined;
}

/** Events in order on Ant Design's Timeline (a list): title and time, then a description and who did it. */
export function Timeline({ items, dense = false, className }: TimelineProps) {
  return (
    <AntTimeline
      className={cx(styles.timeline, dense && styles.dense, className)}
      items={items.map((item, index) => ({
        key: item.id ?? String(index),
        color: DOT_COLOR[item.tone ?? 'neutral'],
        ...(item.icon
          ? {
              dot: (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              ),
            }
          : {}),
        children: (
          <div className={styles.content}>
            <div className={styles.head}>
              <div className={styles.title}>{item.title}</div>
              {item.time ? <time className={styles.time}>{item.time}</time> : null}
            </div>
            {item.description ? <div className={styles.description}>{item.description}</div> : null}
            {item.actor ? (
              <div className={styles.actor}>
                <Avatar name={item.actor} size="xs" />
                <span>{item.actor}</span>
              </div>
            ) : null}
          </div>
        ),
      }))}
    />
  );
}

export interface StepperStep {
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Zero-based index of the current step. */
  current: number;
  orientation?: 'horizontal' | 'vertical';
  className?: string | undefined;
}

/** Ant Design's Steps as a list: each step is a list item, the current one has aria-current="step". */
export function Stepper({ steps, current, orientation = 'horizontal', className }: StepperProps) {
  const label = useLabels();
  return (
    <Steps
      {...({ role: 'list' } as object)}
      size="small"
      current={current}
      direction={orientation}
      responsive={false}
      className={cx(styles.stepper, className)}
      items={steps.map((step, index) => {
        const done = index < current;
        return {
          role: 'listitem',
          ...(index === current ? { 'aria-current': 'step' } : {}),
          ...(done
            ? {
                icon: (
                  <span className={styles.check} aria-hidden="true">
                    <CheckOutlined aria-hidden="true" aria-label="" />
                  </span>
                ),
              }
            : {}),
          title: (
            <>
              {step.label}
              {done ? <span className={styles.srOnly}> {label('stepper.completed')}</span> : null}
            </>
          ),
          ...(step.description ? { description: step.description } : {}),
        };
      })}
    />
  );
}
