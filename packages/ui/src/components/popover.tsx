// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Popover as AntPopover } from 'antd';
import { cloneElement, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { useDir } from '../provider';
import { cx } from '../types';
import styles from './popover.module.css';

export interface PopoverProps {
  trigger: ReactElement;
  children?: ReactNode;
  /** Line the panel up with the trigger's inline start or inline end. */
  align?: 'start' | 'end';
  /** Panel width in pixels. Default: the content's width, at least 240. */
  width?: number;
  /** Accessible name of the panel. */
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string | undefined;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A non-modal panel (role dialog) on Ant Design's Popover, opened by a button. Escape and an outside click close it. */
export function Popover({ trigger, children, align = 'start', width, label, open: openProp, onOpenChange, className }: PopoverProps) {
  const dir = useDir();
  const panelId = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const byKeyboard = useRef(false);

  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const focusTrigger = () => {
    const element = anchorRef.current?.firstElementChild;
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open || !byKeyboard.current) return;
    const panel = panelRef.current;
    if (!panel) return;
    (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus({ preventScroll: true });
  }, [open]);

  const onEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    focusTrigger();
  };

  const start = dir === 'rtl' ? 'bottomRight' : 'bottomLeft';
  const end = dir === 'rtl' ? 'bottomLeft' : 'bottomRight';

  const triggerElement = cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
  });

  return (
    <AntPopover
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      trigger={['click']}
      placement={align === 'end' ? end : start}
      arrow={false}
      destroyOnHidden
      transitionName=""
      content={
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cx(styles.panel, className)}
          style={width ? { inlineSize: width } : undefined}
          onKeyDown={onEscape}
        >
          {children}
        </div>
      }
    >
      <span
        ref={anchorRef}
        className={styles.anchor}
        onKeyDown={onEscape}
        onClick={(event) => {
          if (event.defaultPrevented) return;
          byKeyboard.current = event.detail === 0;
          setOpen(!open);
        }}
      >
        {triggerElement}
      </span>
    </AntPopover>
  );
}
