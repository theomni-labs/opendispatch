'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';

/** How often the screen asks the server again while a download, a verification or a restore request is under way. */
export const PHASE_REFRESH_MS = 1000;

/**
 * Asks the server for the page again every second while `active` is true, and stops the moment it is not (so an idle screen
 * never polls). The scripted update agent works out a download or a restore request from the clock of the data layer when it is
 * read: the phase moves on only if the screen reads again. The interval is the whole mechanism: no timer of its own tracks
 * progress, and nothing here invents a step the data does not report.
 */
export function usePhaseRefresh(active: boolean, everyMs: number = PHASE_REFRESH_MS): void {
  const router = useRouter();
  const latest = useRef(router);
  useEffect(() => {
    latest.current = router;
  });
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => latest.current.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
}
