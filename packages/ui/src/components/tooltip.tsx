// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Tooltip as AntTooltip } from 'antd';
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useDir } from '../provider';
import styles from './tooltip.module.css';

export type TooltipSide = 'top' | 'bottom' | 'start' | 'end';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  /** Preferred side; Ant Design flips it when it does not fit. */
  side?: TooltipSide;
}

/** Hover and focus wait this long, in milliseconds. */
const DELAY = 300;
/** A tooltip shown by tapping an aria-disabled control hides after this long. */
const TAP_DURATION = 2600;

/**
 * A short explanation on hover and keyboard focus, closed by Escape, on Ant Design's Tooltip. The trigger is
 * described by the tooltip (aria-describedby). An aria-disabled control never acts: a tap or click on it shows the
 * tooltip for a few seconds and the click is stopped, which is how a screen says why an action is unavailable.
 */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const dir = useDir();
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (content === null || content === undefined || content === '') return children;

  const later = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), DELAY);
  };
  const now = (hideAfter: number) => {
    window.clearTimeout(timer.current);
    setOpen(true);
    timer.current = window.setTimeout(() => setOpen(false), hideAfter);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const onDisabled = (target: EventTarget): boolean => {
    const anchor = anchorRef.current;
    if (!anchor || !(target instanceof Element)) return false;
    const found = target.closest('[aria-disabled="true"]');
    return found !== null && anchor.contains(found);
  };

  const own = children.props as Record<string, unknown>;
  const describedBy = [own['aria-describedby'], open ? tipId : undefined].filter(Boolean).join(' ') || undefined;
  const child = cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-describedby': describedBy });

  let placement: 'top' | 'bottom' | 'left' | 'right' = side === 'bottom' ? 'bottom' : 'top';
  if (side === 'start') placement = dir === 'rtl' ? 'right' : 'left';
  if (side === 'end') placement = dir === 'rtl' ? 'left' : 'right';

  return (
    <AntTooltip
      title={content}
      open={open}
      trigger={[]}
      placement={placement}
      id={tipId}
      destroyOnHidden
      transitionName=""
    >
      <span
        ref={anchorRef}
        className={styles.anchor}
        aria-describedby={undefined}
        onMouseEnter={later}
        onMouseLeave={hide}
        onFocus={later}
        onBlur={hide}
        onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
          if (!onDisabled(event.target)) hide();
        }}
        onClickCapture={(event: MouseEvent<HTMLSpanElement>) => {
          if (!onDisabled(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          now(TAP_DURATION);
        }}
      >
        {child}
      </span>
    </AntTooltip>
  );
}
