// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { BellOutlined, CloseOutlined, DownOutlined, MenuOutlined } from '@ant-design/icons';
import { Drawer } from 'antd';
import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useActivePath, useDir, useLabels, useLink, type LinkComponentProps } from '../provider/provider';
import { cx } from '../types';
import styles from './rail-shell.module.css';

/** The provider's link component, rendered by a component of its own so the shell can use it anywhere. */
function ProviderLink(props: LinkComponentProps) {
  return createElement(useLink(), props);
}

/**
 * The application shell: an icon rail on the inline start whose buttons open fly-outs of links, a top bar with the
 * brand, the search and the application's own controls, the page in <main>, and below 1024px a navigation drawer
 * (Ant Design Drawer) opened from a menu button. The `data-shell*` attributes are hooks for end-to-end tests.
 */

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** A marker after the label. Decorative unless `iconLabel` names it. */
  icon?: ReactNode;
  iconLabel?: string;
  badge?: string | number;
  /** Items with the same section sit under one heading. */
  section?: string;
  /** Overrides the match against the active path. */
  active?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: readonly NavItem[];
}

export interface NavBrand {
  href: string;
  /** The accessible name of the brand link. */
  label: string;
  /** The mark on the rail. */
  mark: ReactNode;
  /** The word mark in the top bar. Default: `label`. */
  name?: ReactNode;
  /** A line after the word mark, such as the console's name. */
  context?: ReactNode;
}

export interface RailShellProps {
  groups: readonly NavGroup[];
  brand: NavBrand;
  /** The search of the top bar, for example a CommandPalette. */
  search?: ReactNode;
  /** The inline end of the top bar. */
  end?: ReactNode;
  children?: ReactNode;
  /** The id of <main>, the target of the skip link. */
  mainId?: string;
  className?: string | undefined;
}

const QUIET = { 'aria-hidden': true, 'aria-label': '' } as const;
const DESKTOP = '(min-width: 1024px)';
const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

interface Marked {
  item: NavItem;
  active: boolean;
}

interface MarkedGroup {
  group: NavGroup;
  items: Marked[];
  active: boolean;
}

const pathPart = (href: string): string => href.split(/[?#]/, 1)[0] ?? href;
const trimSlash = (path: string): string => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);

function under(current: string, href: string): boolean {
  if (href === '') return false;
  if (href === '/') return current === '/';
  return current === href || current.startsWith(`${href}/`);
}

/** Marks the item whose href is the longest match of the active path, and the group that holds it. */
function markActive(groups: readonly NavGroup[], activePath: string): MarkedGroup[] {
  const current = trimSlash(pathPart(activePath));
  let best: string | undefined;
  if (current !== '') {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.active !== undefined) continue;
        const href = trimSlash(pathPart(item.href));
        if (under(current, href) && (best === undefined || href.length > best.length)) best = href;
      }
    }
  }
  return groups.map((group) => {
    const items = group.items.map((item) => ({
      item,
      active: item.active ?? (best !== undefined && trimSlash(pathPart(item.href)) === best),
    }));
    return { group, items, active: items.some((entry) => entry.active) };
  });
}

interface Section {
  heading: string | undefined;
  items: Marked[];
}

function sections(items: readonly Marked[]): Section[] {
  const out: Section[] = [];
  for (const entry of items) {
    const last = out.at(-1);
    const heading = entry.item.section;
    if (last && (heading === undefined || heading === last.heading)) last.items.push(entry);
    else out.push({ heading, items: [entry] });
  }
  return out;
}

function ItemTail({ item }: { item: NavItem }) {
  return (
    <>
      {item.icon ? (
        item.iconLabel === undefined ? (
          <span aria-hidden="true" className={styles['marker']}>
            {item.icon}
          </span>
        ) : (
          <span role="img" aria-label={item.iconLabel} className={styles['marker']}>
            {item.icon}
          </span>
        )
      ) : null}
      {item.badge === undefined ? null : <span className={styles['itemBadge']}>{item.badge}</span>}
    </>
  );
}

function nextIndex(at: number, length: number, key: string): number {
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return key === 'ArrowDown' ? (at + 1) % length : (at - 1 + length) % length;
}

export function RailShell({ groups, brand, search, end, children, mainId = 'main-content', className }: RailShellProps) {
  const label = useLabels();
  const dir = useDir();
  const activePath = useActivePath();
  const baseId = useId();
  const navRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const byKeyboard = useRef(false);
  const focusFirst = useRef<string | null>(null);
  /** The open fly-out; `pinned` when a click or a key opened it (hover alone closes on leave). */
  const [open, setOpen] = useState<{ id: string; pinned: boolean } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({});
  const marked = useMemo(() => markActive(groups, activePath), [groups, activePath]);
  const wordmark = brand.name ?? brand.label;
  const openId = open?.id;

  const groupNode = (id: string): HTMLElement | undefined =>
    [...(navRef.current?.querySelectorAll<HTMLElement>('[data-shell-group]') ?? [])].find((node) => node.dataset['shellGroup'] === id);

  // Opened from the keyboard: the first link takes the focus once the fly-out shows.
  useEffect(() => {
    const id = focusFirst.current;
    if (id === null || openId !== id) return;
    focusFirst.current = null;
    groupNode(id)?.querySelector<HTMLElement>('[data-shell-item]')?.focus();
  }, [openId]);

  // Escape closes the fly-out (focus back on its button); so does a press outside the rail.
  useEffect(() => {
    if (openId === undefined) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const node = groupNode(openId);
      if (node?.contains(document.activeElement)) node.querySelector<HTMLElement>('[data-shell-trigger]')?.focus();
      setOpen(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) return;
      setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [openId]);

  // The drawer is for narrow windows: widening the window closes it.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (query.matches) setDrawerOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const hoverIn = (event: ReactPointerEvent, id: string) => {
    if (event.pointerType === 'touch') return;
    setOpen((before) => (before?.id === id && before.pinned ? before : { id, pinned: false }));
  };
  const hoverOut = (event: ReactPointerEvent, id: string) => {
    if (event.pointerType === 'touch') return;
    setOpen((before) => (before?.id === id && !before.pinned ? null : before));
  };
  const focusOut = (event: ReactFocusEvent<HTMLElement>, id: string) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setOpen((before) => (before?.id === id && before.pinned ? null : before));
  };
  const toggle = (id: string) => {
    const keyboard = byKeyboard.current;
    byKeyboard.current = false;
    if (open?.id === id && open.pinned) {
      setOpen(null);
      return;
    }
    focusFirst.current = keyboard ? id : null;
    setOpen({ id, pinned: true });
  };

  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const nav = navRef.current;
    const target = event.target;
    if (!nav || !(target instanceof HTMLElement)) return;
    const intoFlyout = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backToRail = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const trigger = target.closest<HTMLElement>('[data-shell-trigger]');
    if (trigger) {
      if (event.key === 'Enter' || event.key === ' ') {
        byKeyboard.current = true;
      } else if (MOVE_KEYS.has(event.key)) {
        const all = [...nav.querySelectorAll<HTMLElement>('[data-shell-trigger]')];
        all[nextIndex(all.indexOf(trigger), all.length, event.key)]?.focus();
        event.preventDefault();
      } else if (event.key === intoFlyout) {
        const id = trigger.dataset['shellTrigger'];
        if (id !== undefined) {
          focusFirst.current = id;
          setOpen({ id, pinned: true });
        }
        event.preventDefault();
      }
      return;
    }
    const flyout = target.closest<HTMLElement>('[data-shell-flyout]');
    if (!flyout || !target.closest('[data-shell-item]')) return;
    if (MOVE_KEYS.has(event.key)) {
      const links = [...flyout.querySelectorAll<HTMLElement>('[data-shell-item]')];
      links[nextIndex(links.indexOf(target), links.length, event.key)]?.focus();
      event.preventDefault();
    } else if (event.key === backToRail) {
      const id = flyout.dataset['shellFlyout'];
      if (id !== undefined) groupNode(id)?.querySelector<HTMLElement>('[data-shell-trigger]')?.focus();
      setOpen(null);
      event.preventDefault();
    }
  };

  const skip = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  const anyActive = marked.some((entry) => entry.active);

  return (
    <div className={cx(styles['shell'], className)} data-shell="root">
      <a className={styles['skip']} href={`#${mainId}`} onClick={skip}>
        {label('railShell.skip')}
      </a>
      <div className={styles['rail']} data-shell="rail">
        <ProviderLink href={brand.href} className={styles['railBrand']} aria-label={brand.label} data-shell="brand">
          <span className={styles['railMark']} translate="no">
            {brand.mark}
          </span>
        </ProviderLink>
        <nav ref={navRef} className={styles['railNav']} aria-label={label('railShell.nav')} onKeyDown={onNavKey}>
          <ul className={styles['railList']}>
            {marked.map(({ group, items, active }, index) => {
              const isOpen = openId === group.id;
              const flyoutId = `${baseId}-flyout-${String(index)}`;
              return (
                <li
                  key={group.id}
                  className={styles['railEntry']}
                  data-shell-group={group.id}
                  data-open={isOpen ? 'true' : 'false'}
                  onPointerEnter={(event) => hoverIn(event, group.id)}
                  onPointerLeave={(event) => hoverOut(event, group.id)}
                  onBlur={(event) => focusOut(event, group.id)}
                >
                  <button
                    type="button"
                    className={styles['railButton']}
                    data-shell-trigger={group.id}
                    data-active={active ? 'true' : 'false'}
                    aria-label={group.label}
                    aria-expanded={isOpen}
                    aria-controls={flyoutId}
                    onPointerDown={() => {
                      byKeyboard.current = false;
                    }}
                    onClick={() => toggle(group.id)}
                  >
                    <span className={styles['railIcon']} aria-hidden="true">
                      {group.icon ?? <span className={styles['initial']}>{[...group.label][0] ?? ''}</span>}
                    </span>
                  </button>
                  <div
                    id={flyoutId}
                    className={styles['flyout']}
                    role="group"
                    aria-labelledby={`${flyoutId}-title`}
                    hidden={!isOpen}
                    data-shell-flyout={group.id}
                  >
                    <div id={`${flyoutId}-title`} className={styles['flyoutTitle']}>
                      {group.label}
                    </div>
                    {sections(items).map((section, sectionIndex) => {
                      const headingId = section.heading === undefined ? undefined : `${flyoutId}-h${String(sectionIndex)}`;
                      return (
                        <div key={`${String(sectionIndex)}-${section.heading ?? ''}`}>
                          {headingId === undefined ? null : (
                            <div id={headingId} className={styles['sectionHeading']}>
                              {section.heading}
                            </div>
                          )}
                          <ul className={styles['linkList']} aria-labelledby={headingId}>
                            {section.items.map(({ item, active: current }) => (
                              <li key={item.id}>
                                <ProviderLink
                                  href={item.href}
                                  className={styles['flyoutLink']}
                                  aria-current={current ? 'page' : undefined}
                                  data-shell-item={item.id}
                                  onClick={() => setOpen(null)}
                                >
                                  <span className={styles['linkLabel']}>{item.label}</span>
                                  <ItemTail item={item} />
                                </ProviderLink>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <div className={styles['column']}>
        <header className={styles['topbar']} data-shell="topbar">
          <button
            type="button"
            className={cx(styles['iconButton'], styles['menuButton'])}
            aria-label={label('railShell.menuOpen')}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <MenuOutlined {...QUIET} />
          </button>
          <ProviderLink href={brand.href} className={styles['brand']}>
            <span className={styles['wordmark']} translate="no">
              {wordmark}
            </span>
            {brand.context ? <span className={styles['context']}>{brand.context}</span> : null}
          </ProviderLink>
          {search ? <div className={styles['search']}>{search}</div> : null}
          <div className={styles['end']}>{end}</div>
        </header>
        <main id={mainId} ref={mainRef} tabIndex={-1} className={styles['main']} data-shell="main">
          {children}
        </main>
      </div>
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={wordmark}
        placement={dir === 'rtl' ? 'right' : 'left'}
        width={320}
        aria-label={brand.label}
        closable={false}
        extra={
          <button type="button" className={styles['iconButton']} aria-label={label('drawer.close')} onClick={() => setDrawerOpen(false)}>
            <CloseOutlined {...QUIET} />
          </button>
        }
        classNames={{ body: styles['drawerBody'] ?? '' }}
      >
        <nav aria-label={label('railShell.nav')} data-shell="drawer-nav">
          {marked.map(({ group, items, active }, index) => {
            const isExpanded = expanded[group.id] ?? (active || (!anyActive && index === 0));
            const panelId = `${baseId}-drawer-${String(index)}`;
            return (
              <div key={group.id} className={styles['drawerGroup']}>
                <button
                  type="button"
                  className={styles['drawerGroupButton']}
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() => setExpanded((before) => ({ ...before, [group.id]: !isExpanded }))}
                >
                  {group.icon ? (
                    <span className={styles['railIcon']} aria-hidden="true">
                      {group.icon}
                    </span>
                  ) : null}
                  <span className={styles['linkLabel']}>{group.label}</span>
                  <DownOutlined {...QUIET} className={styles['chevron']} />
                </button>
                <div id={panelId} hidden={!isExpanded}>
                  {sections(items).map((section, sectionIndex) => {
                    const headingId = section.heading === undefined ? undefined : `${panelId}-h${String(sectionIndex)}`;
                    return (
                      <div key={`${String(sectionIndex)}-${section.heading ?? ''}`}>
                        {headingId === undefined ? null : (
                          <div id={headingId} className={styles['sectionHeading']}>
                            {section.heading}
                          </div>
                        )}
                        <ul className={styles['linkList']} aria-labelledby={headingId}>
                          {section.items.map(({ item, active: current }) => (
                            <li key={item.id}>
                              <ProviderLink
                                href={item.href}
                                className={styles['drawerLink']}
                                aria-current={current ? 'page' : undefined}
                                data-shell-item={item.id}
                                onClick={() => setDrawerOpen(false)}
                              >
                                <span className={styles['linkLabel']}>{item.label}</span>
                                <ItemTail item={item} />
                              </ProviderLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </Drawer>
    </div>
  );
}

export type NotificationsBellProps = {
  /** Unread items. Zero shows no count; above 99 the count reads "99+". */
  unreadCount: number;
  className?: string | undefined;
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: () => void } | { href?: undefined; onClick?: undefined });

/**
 * The bell of the top bar. A link with `href`, a button with `onClick`, and with neither a plain image that Tab skips.
 * The accessible name carries the count; the visible count is hidden from screen readers so it is not read twice.
 */
export function NotificationsBell({ unreadCount, href, onClick, className }: NotificationsBellProps) {
  const label = useLabels();
  const unread = Number.isFinite(unreadCount) ? Math.max(0, Math.trunc(unreadCount)) : 0;
  const name = unread > 0 ? label('railShell.notificationsUnread', { count: unread }) : label('railShell.notifications');
  const body = (
    <>
      <BellOutlined {...QUIET} />
      {unread > 0 ? (
        <span className={styles['count']} aria-hidden="true" data-shell="bell-count">
          {unread > 99 ? '99+' : String(unread)}
        </span>
      ) : null}
    </>
  );
  const classes = cx(styles['iconButton'], className);
  if (href !== undefined) {
    return (
      <ProviderLink href={href} className={classes} aria-label={name} data-shell="bell">
        {body}
      </ProviderLink>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" className={classes} aria-label={name} onClick={onClick} data-shell="bell">
        {body}
      </button>
    );
  }
  return (
    <span role="img" className={cx(classes, styles['inert'])} aria-label={name} data-shell="bell">
      {body}
    </span>
  );
}
