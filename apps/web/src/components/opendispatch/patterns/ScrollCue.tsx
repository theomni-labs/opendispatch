'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { scrollCue } from './scroll-cue';
import styles from './ScrollCue.module.css';

// Marks each table's scrolling box with data-cue
export function useScrollCue(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const tables = [...root.querySelectorAll('table')];
    const scrollers = tables.map((table) => table.parentElement).filter((s): s is HTMLElement => s !== null);
    const updates = scrollers.map((scroller) => {
      const update = () => {
        scroller.dataset['cue'] = scrollCue(scroller);
      };
      update();
      scroller.addEventListener('scroll', update, { passive: true });
      return { scroller, update };
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updates.forEach(({ update }) => update()));
    for (const { scroller } of updates) observer?.observe(scroller);
    for (const table of tables) observer?.observe(table);
    return () => {
      for (const { scroller, update } of updates) scroller.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref]);
}

/** Wide tables inside fade at the inline end while more is hidden. */
export function ScrollCue({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollCue(ref);
  return (
    <div ref={ref} className={styles.cue}>
      {children}
    </div>
  );
}
