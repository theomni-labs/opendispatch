// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import '@ant-design/v5-patch-for-react-19';
import { ConfigProvider } from 'antd';
import arEG from 'antd/locale/ar_EG';
import enUS from 'antd/locale/en_US';
import { createContext, useContext, useMemo, type ComponentPropsWithRef, type ComponentType, type ReactNode } from 'react';
import { themeFor, type ColorScheme } from '../theme/palette';
import { DEFAULT_LABELS, createLabelFn, type LabelFn, type LabelMap } from './labels';

/**
 * What the components need from the application: language, direction, colour scheme, the router's link and
 * navigation, the active path and the translated labels. It also sets up Ant Design's ConfigProvider (direction,
 * locale pack and theme). Every hook works without a provider: English, left to right, light, a plain <a>.
 */

export type Direction = 'ltr' | 'rtl';

export interface LinkComponentProps extends ComponentPropsWithRef<'a'> {
  href: string;
}
export type LinkComponent = ComponentType<LinkComponentProps>;
/** A LinkComponent or a router Link (whose optional props may not allow `undefined`). */
export type LinkComponentInput = LinkComponent | ComponentType<never>;
export type NavigateFn = (href: string) => void;

const RIGHT_TO_LEFT = new Set(['ar', 'he', 'fa', 'ur']);

/** The writing direction of a language tag. */
export function directionOf(locale: string): Direction {
  return RIGHT_TO_LEFT.has((locale.split('-')[0] ?? '').toLowerCase()) ? 'rtl' : 'ltr';
}

function PlainLink(props: LinkComponentProps) {
  return <a {...props} />;
}

interface Settings {
  locale: string;
  dir: Direction;
  colorScheme: ColorScheme;
  labels: LabelMap;
  label: LabelFn;
  linkComponent: LinkComponent;
  navigate: NavigateFn;
  activePath: string;
}

const BASE: Settings = {
  locale: 'en',
  dir: 'ltr',
  colorScheme: 'light',
  labels: DEFAULT_LABELS,
  label: createLabelFn(DEFAULT_LABELS),
  linkComponent: PlainLink,
  navigate: (href) => window.location.assign(href),
  activePath: '',
};

const SettingsContext = createContext<Settings>(BASE);

export interface DesignSystemProviderProps {
  locale?: string | undefined;
  /** Default: from the locale. */
  dir?: Direction | undefined;
  /** Default: light, or the enclosing provider's. */
  colorScheme?: ColorScheme | undefined;
  labels?: LabelMap | undefined;
  linkComponent?: LinkComponentInput | undefined;
  navigate?: NavigateFn | undefined;
  activePath?: string | undefined;
  children?: ReactNode;
}

/** A nested provider changes only what it is given. */
export function DesignSystemProvider(props: DesignSystemProviderProps) {
  const parent = useContext(SettingsContext);
  const { locale, dir, colorScheme, labels, linkComponent, navigate, activePath, children } = props;

  const settings = useMemo<Settings>(() => {
    const merged = labels ? { ...parent.labels, ...labels } : parent.labels;
    let direction = parent.dir;
    if (dir) direction = dir;
    else if (locale !== undefined) direction = directionOf(locale);
    return {
      locale: locale ?? parent.locale,
      dir: direction,
      colorScheme: colorScheme ?? parent.colorScheme,
      labels: merged,
      label: merged === parent.labels ? parent.label : createLabelFn(merged),
      linkComponent: (linkComponent as LinkComponent | undefined) ?? parent.linkComponent,
      navigate: navigate ?? parent.navigate,
      activePath: activePath ?? parent.activePath,
    };
  }, [parent, locale, dir, colorScheme, labels, linkComponent, navigate, activePath]);

  const antdTheme = useMemo(() => themeFor(settings.colorScheme), [settings.colorScheme]);
  const antdLocale = settings.locale.toLowerCase().startsWith('ar') ? arEG : enUS;

  return (
    <SettingsContext.Provider value={settings}>
      <ConfigProvider direction={settings.dir} locale={antdLocale} theme={antdTheme}>
        {children}
      </ConfigProvider>
    </SettingsContext.Provider>
  );
}

export function useLocale(): string {
  return useContext(SettingsContext).locale;
}
export function useDir(): Direction {
  return useContext(SettingsContext).dir;
}
export function useColorScheme(): ColorScheme {
  return useContext(SettingsContext).colorScheme;
}
export function useLabels(): LabelFn {
  return useContext(SettingsContext).label;
}
export function useLink(): LinkComponent {
  return useContext(SettingsContext).linkComponent;
}
export function useNavigate(): NavigateFn {
  return useContext(SettingsContext).navigate;
}
export function useActivePath(): string {
  return useContext(SettingsContext).activePath;
}
