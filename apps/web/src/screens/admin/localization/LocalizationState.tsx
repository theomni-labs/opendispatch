'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAdminAction, type AdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useTranslations } from 'next-intl';
import { saveLocalization } from './actions';
import type { Settings } from './types';

// The state the Localization screen's header and its form share (client). The header's Save and the form's controls are in different
// parts of the page (the frame renders the header and the body apart), so the draft lives here, above both: this provider wraps the
// frame, and the two read it through `useLocalization`. The draft starts from what the server holds and starts again whenever that
// changes (after a save, a reset, or a change made elsewhere). Nothing here reads a context or a role: a view-only person's `canEdit`
// arrives as data and every control disabled by it says why.

interface LocalizationState {
  readonly saved: Settings;
  readonly draft: Settings;
  readonly setDraft: (next: Settings) => void;
  readonly dirty: boolean;
  readonly canEdit: boolean;
  /** The screen shows a review state: there is nothing to save. */
  readonly review: boolean;
  readonly save: AdminAction<[Settings]>;
}

const State = createContext<LocalizationState | null>(null);

const same = (a: Settings, b: Settings): boolean =>
  a.default_locale === b.default_locale && a.digit_system === b.digit_system && a.primary_calendar === b.primary_calendar && a.show_secondary_calendar === b.show_secondary_calendar && a.first_day_of_week === b.first_day_of_week;

export function useLocalization(): LocalizationState {
  const value = useContext(State);
  if (value === null) throw new Error('useLocalization is used outside LocalizationProvider.');
  return value;
}

export interface LocalizationProviderProps {
  readonly saved: Settings;
  readonly canEdit: boolean;
  readonly review?: boolean | undefined;
  readonly children: ReactNode;
}

export function LocalizationProvider({ saved, canEdit, review = false, children }: LocalizationProviderProps) {
  const m = useTranslations('admin.localization');
  const [draft, setDraft] = useState<Settings>(saved);
  const [held, setHeld] = useState(() => JSON.stringify(saved));
  if (JSON.stringify(saved) !== held) {
    setHeld(JSON.stringify(saved));
    setDraft(saved);
  }
  const save = useAdminAction(saveLocalization, { successTitle: m('toast.saved') });
  const value = useMemo<LocalizationState>(() => ({ saved, draft, setDraft, dirty: !same(draft, saved), canEdit, review, save }), [saved, draft, canEdit, review, save]);
  return <State.Provider value={value}>{children}</State.Provider>;
}
