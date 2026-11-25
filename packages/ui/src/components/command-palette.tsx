// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { SearchOutlined } from '@ant-design/icons';
import { Input, type InputRef } from 'antd';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useLabels, useLink, useNavigate } from '../provider/provider';
import { cx } from '../types';
import styles from './command-palette.module.css';

/**
 * The search box of the top bar: an Ant Design Input as a combobox, with a listbox of links below it. Typing filters
 * the items by label, meta and keywords (Arabic spelling variants and digits folded); arrows move, Enter opens,
 * Escape closes the list and then clears the text. The number of results is announced in a status region.
 */

export interface CommandPaletteItem {
  id: string;
  label: string;
  /** A second line, such as the console the page is in. Searched too. */
  meta?: string;
  href: string;
  /** More words to match, such as the label in the other language. */
  keywords?: string;
}

export interface CommandPaletteProps {
  items: readonly CommandPaletteItem[];
  placeholder?: string | undefined;
  'aria-label'?: string | undefined;
  /** A single key that focuses the box from anywhere on the page, such as "/". */
  shortcut?: string | undefined;
  /** Default 8. */
  maxResults?: number;
  className?: string | undefined;
  id?: string | undefined;
}

const DIRECTION_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/g;
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const ALEF_VARIANTS = /[آأإٱ]/g;

/**
 * Folds text for matching: Unicode compatibility forms, no direction controls or Arabic diacritics, Arabic-Indic
 * digits as 0 to 9, one alef, alef maqsura as yeh, teh marbuta as heh, lower case, single spaces.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(DIRECTION_CONTROLS, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(ARABIC_DIGITS, (digit) => String((digit.codePointAt(0) ?? 0) % 16))
    .replace(ALEF_VARIANTS, 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function typingElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function CommandPalette({
  items,
  placeholder,
  'aria-label': ariaLabel,
  shortcut,
  maxResults = 8,
  className,
  id,
}: CommandPaletteProps) {
  const label = useLabels();
  const Link = useLink();
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-results`;
  const optionId = (index: number) => `${baseId}-result-${String(index)}`;
  const inputRef = useRef<InputRef>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const index = useMemo(
    () =>
      items.map((item) => ({
        item,
        texts: [item.label, item.meta, item.keywords]
          .filter((text): text is string => text !== undefined)
          .map(normalizeSearchText)
          .filter((text) => text !== ''),
      })),
    [items],
  );

  const needle = normalizeSearchText(query);
  const limit = Math.max(1, Math.floor(maxResults));
  const results = useMemo(
    () => (needle === '' ? [] : index.filter((entry) => entry.texts.some((text) => text.includes(needle))).slice(0, limit).map((entry) => entry.item)),
    [index, needle, limit],
  );

  const showing = open && needle !== '';
  const expanded = showing && results.length > 0;
  const current = Math.min(active, results.length - 1);
  const placeholderText = placeholder ?? label('commandPalette.placeholder');
  let announcement = '';
  if (needle !== '') announcement = results.length > 0 ? label('commandPalette.count', { count: results.length }) : label('commandPalette.empty');

  useEffect(() => {
    if (!shortcut) return undefined;
    const key = shortcut.toLowerCase();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== key || typingElsewhere(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  useEffect(() => {
    if (!expanded) return;
    const node = document.getElementById(`${baseId}-result-${String(current)}`);
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [expanded, current, baseId]);

  const reset = () => {
    setQuery('');
    setOpen(false);
    setActive(0);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setOpen(true);
    setActive(0);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (needle === '') return;
      event.preventDefault();
      if (!showing) setOpen(true);
      else if (results.length > 0) setActive((current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (event.key === 'Enter') {
      const chosen = expanded ? results[current] : undefined;
      if (!chosen) return;
      event.preventDefault();
      navigate(chosen.href);
      reset();
    } else if (event.key === 'Escape') {
      if (showing) {
        setOpen(false);
        event.stopPropagation();
      } else if (query !== '') {
        setQuery('');
        event.stopPropagation();
      }
    }
  };

  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  return (
    <div role="search" className={cx(styles['root'], className)} data-shell="search" onBlur={onBlur}>
      <Input
        ref={inputRef}
        {...(id === undefined ? {} : { id })}
        type="search"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholderText}
        aria-label={ariaLabel ?? placeholderText}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? optionId(current) : undefined}
        aria-keyshortcuts={shortcut}
        value={query}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        prefix={<SearchOutlined aria-hidden="true" aria-label="" className={styles['icon']} />}
        suffix={shortcut && query === '' ? <kbd className={styles['kbd']} aria-hidden="true">{shortcut}</kbd> : <span />}
      />
      <div className={styles['popup']} hidden={!showing} data-shell="search-popup">
        <div
          id={listId}
          role="listbox"
          aria-label={label('commandPalette.results')}
          className={styles['list']}
          hidden={!expanded}
          // A press on the list keeps the focus in the box, or the list would close before the click lands.
          onMouseDown={(event) => event.preventDefault()}
        >
          {results.map((result, position) => (
            <Link
              key={result.id}
              id={optionId(position)}
              role="option"
              aria-selected={position === current}
              tabIndex={-1}
              href={result.href}
              className={styles['option']}
              data-active={position === current ? 'true' : 'false'}
              onMouseMove={() => setActive(position)}
              onClick={reset}
            >
              <span className={styles['optionLabel']}>{result.label}</span>
              {result.meta ? <span className={styles['meta']}>{result.meta}</span> : null}
            </Link>
          ))}
        </div>
        {showing && results.length === 0 ? (
          <div className={styles['empty']} aria-hidden="true" data-shell="search-empty">
            {label('commandPalette.empty')}
          </div>
        ) : null}
      </div>
      <div role="status" className={styles['visuallyHidden']}>
        {announcement}
      </div>
    </div>
  );
}
