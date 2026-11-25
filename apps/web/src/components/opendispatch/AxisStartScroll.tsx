'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** A horizontal scroller that opens at the left end, where a left-to-right time axis starts, in RTL too. */
export function AxisStartScroll({ className, children }: { readonly className?: string | undefined; readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && getComputedStyle(element).direction === 'rtl') element.scrollLeft = element.clientWidth - element.scrollWidth;
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
