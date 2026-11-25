// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { CheckOutlined } from '@ant-design/icons';
import { Dropdown } from 'antd';
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useDir, useLink } from '../provider';
import { cx } from '../types';
import styles from './menu.module.css';

export interface MenuItem {
  type?: 'item';
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}

/** A small title over the entries after it. Not focusable. */
export interface MenuHeading {
  type: 'heading';
  label: ReactNode;
}

export interface MenuRadioOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

/** One choice out of several, as menuitemradio entries in a named group. */
export interface MenuRadioGroup {
  type: 'radio-group';
  options: MenuRadioOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  heading?: ReactNode;
  label?: string;
}

export type MenuEntry = MenuItem | MenuHeading | MenuRadioGroup | 'separator';

export interface MenuProps {
  /** A button. It gets aria-haspopup and aria-expanded; a click opens and closes the menu. */
  trigger: ReactElement;
  items: MenuEntry[];
  /** Line the menu up with the trigger's inline start or inline end. */
  align?: 'start' | 'end';
  /** Accessible name of the menu. */
  label?: string;
  className?: string | undefined;
}

const ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])';

/** An action menu on Ant Design's Dropdown. Arrow keys, Home and End move; Escape and Tab close it. */
export function Menu({ trigger, items, align = 'start', label, className }: MenuProps) {
  const Link = useLink();
  const dir = useDir();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const byKeyboard = useRef(false);

  const focusTrigger = () => {
    const element = anchorRef.current?.firstElementChild;
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) focusTrigger();
  };

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (byKeyboard.current) panel.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });
  }, [open]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const list = Array.from(panel.querySelectorAll<HTMLElement>(ITEMS));
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      list[index]?.focus();
    };
    if (event.key === 'ArrowDown') go((at + 1) % list.length);
    else if (event.key === 'ArrowUp') go(at <= 0 ? list.length - 1 : at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  };

  const hoverFocus = (event: MouseEvent<HTMLElement>) => {
    if (event.currentTarget.getAttribute('aria-disabled') !== 'true') event.currentTarget.focus({ preventScroll: true });
  };

  const body = (icon: ReactNode, text: ReactNode, shortcut?: string) => (
    <>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.label}>{text}</span>
      {shortcut ? <span className={styles.shortcut}>{shortcut}</span> : null}
    </>
  );

  const renderItem = (item: MenuItem, key: string) => {
    const itemClass = cx(styles.item, item.danger && styles.danger);
    const choose = (event: MouseEvent<HTMLElement>) => {
      if (item.disabled) {
        event.preventDefault();
        return;
      }
      close(true);
      item.onSelect?.();
    };
    if (item.href && !item.disabled) {
      return (
        <Link key={key} href={item.href} role="menuitem" tabIndex={-1} className={itemClass} onClick={choose} onMouseEnter={hoverFocus}>
          {body(item.icon, item.label, item.shortcut)}
        </Link>
      );
    }
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={item.disabled || undefined}
        className={itemClass}
        onClick={choose}
        onMouseEnter={hoverFocus}
      >
        {body(item.icon, item.label, item.shortcut)}
      </button>
    );
  };

  const renderGroup = (group: MenuRadioGroup, key: string) => {
    const headingId = `${menuId}-${key}`;
    return (
      <div
        key={key}
        role="group"
        aria-labelledby={group.heading ? headingId : undefined}
        aria-label={group.heading ? undefined : group.label}
      >
        {group.heading ? (
          <div id={headingId} className={styles.heading}>
            {group.heading}
          </div>
        ) : null}
        {group.options.map((option) => {
          const checked = option.value === group.value;
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              aria-disabled={option.disabled || undefined}
              tabIndex={-1}
              className={styles.item}
              onMouseEnter={hoverFocus}
              onClick={(event) => {
                if (option.disabled) {
                  event.preventDefault();
                  return;
                }
                close(true);
                if (!checked) group.onValueChange(option.value);
              }}
            >
              <span className={styles.check} aria-hidden="true">
                {checked ? <CheckOutlined aria-hidden="true" aria-label="" /> : null}
              </span>
              {body(option.icon, option.label)}
            </button>
          );
        })}
      </div>
    );
  };

  const renderEntry = (entry: MenuEntry, index: number) => {
    const key = `entry-${String(index)}`;
    if (entry === 'separator') return <div key={key} role="separator" className={styles.separator} />;
    if (entry.type === 'heading') {
      return (
        <div key={key} role="presentation" className={styles.heading}>
          {entry.label}
        </div>
      );
    }
    if (entry.type === 'radio-group') return renderGroup(entry, key);
    return renderItem(entry, key);
  };

  const start = dir === 'rtl' ? 'bottomRight' : 'bottomLeft';
  const end = dir === 'rtl' ? 'bottomLeft' : 'bottomRight';

  const triggerElement = cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  });

  return (
    <Dropdown
      open={open}
      onOpenChange={(next, info) => {
        // A click on the trigger is handled below; Ant Design reports outside clicks here.
        if (!next && info.source === 'trigger') setOpen(false);
      }}
      trigger={['click']}
      placement={align === 'end' ? end : start}
      destroyOnHidden
      transitionName=""
      popupRender={() => (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          aria-orientation="vertical"
          tabIndex={-1}
          className={cx(styles.menu, className)}
          onKeyDown={onPanelKeyDown}
        >
          {items.map(renderEntry)}
        </div>
      )}
    >
      <span
        ref={anchorRef}
        className={styles.anchor}
        onClick={(event) => {
          if (event.defaultPrevented) return;
          byKeyboard.current = event.detail === 0;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
            event.preventDefault();
            byKeyboard.current = true;
            setOpen(true);
          }
        }}
      >
        {triggerElement}
      </span>
    </Dropdown>
  );
}
