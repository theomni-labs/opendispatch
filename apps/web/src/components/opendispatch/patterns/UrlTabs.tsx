'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Tabs, type TabItem } from '@opendispatch/ui';
import { useState, type ReactNode } from 'react';
import { useUrlState } from './useUrlState';

// Tabs whose choice is the `tab` search parameter: a link opens the right tab, Back goes to the previous
// one, and the server renders only the active panel. Put it in the ScreenFrame `tabs` slot, where the mockups draw them.
//
//   <UrlTabs id="ur" ariaLabel={t('tabs.label')} defaultTab="users" tabs={[{ value: 'users', label: t('tab.users'), count: 13 }, ...]} />
//   <TabPanel id="ur" value={tab}>...the active tab's content...</TabPanel>
//
// The value is checked against `tabs`: an unknown `?tab=` shows the default tab, the same as the server (parseSearchParams).

export interface UrlTabsProps {
  /** Prefix of the tab element ids (`${id}-tab-${value}`), so a TabPanel can be named by its tab. */
  readonly id: string;
  readonly tabs: readonly TabItem[];
  readonly defaultTab: string;
  readonly ariaLabel: string;
  /** Search parameter that holds the tab. Default `tab`. */
  readonly param?: string;
  /** Parameters removed when the tab changes (the other tab's search text, sort, open record). Default: `q`, `sort`, `id`, `new`. */
  readonly resetParams?: readonly string[];
  /** The tab the server rendered the panel for. When set, the underline follows it, so it always matches the panel. */
  readonly selected?: string;
  /** pill: tabs inside a card (Remote Queue) */
  readonly variant?: 'line' | 'pill';
}

const DEFAULT_RESET = ['q', 'sort', 'id', 'new'] as const;

export function UrlTabs({ id, tabs, defaultTab, ariaLabel, param = 'tab', resetParams = DEFAULT_RESET, selected, variant }: UrlTabsProps) {
  const url = useUrlState();
  const wanted = url.get(param);
  const fromUrl = tabs.some((tab) => tab.value === wanted) ? (wanted as string) : defaultTab;
  // A click shows at once; the server's tab takes over as soon as it changes.
  const [picked, setPicked] = useState<{ from: string; value: string } | null>(null);
  const value = selected === undefined ? fromUrl : picked !== null && picked.from === selected ? picked.value : selected;
  return (
    <Tabs
      id={id}
      ariaLabel={ariaLabel}
      items={[...tabs]}
      value={value}
      variant={variant ?? 'line'}
      onChange={(next) => {
        if (selected !== undefined) setPicked({ from: selected, value: next });
        url.update({ [param]: next === defaultTab ? null : next, ...Object.fromEntries(resetParams.map((key) => [key, null])) });
      }}
    />
  );
}

export interface TabPanelProps {
  id: string;
  /** The active tab's value. */
  value: string;
  children: ReactNode;
}

/** The panel of the active tab: `role="tabpanel"`, named by its tab (`UrlTabs` gives the tab the id `${id}-tab-${value}`). */
export function TabPanel({ id, value, children }: TabPanelProps) {
  return (
    <div role="tabpanel" id={`${id}-panel-${value}`} aria-labelledby={`${id}-tab-${value}`}>
      {children}
    </div>
  );
}
