// SPDX-License-Identifier: AGPL-3.0-only

import { theme, type ThemeConfig } from 'antd';

/** Light or dark. */
export type ColorScheme = 'light' | 'dark';

/**
 * The seed and map tokens handed to Ant Design. The colours match src/styles/tokens.css (tokens.test.ts checks it),
 * so a CSS Module that reads `--od-color-primary` and an Ant Design button agree.
 */
export const PALETTE = {
  light: {
    colorPrimary: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1677ff',
    colorText: '#1f1f1f',
    colorTextSecondary: '#595959',
    colorBgLayout: '#f5f5f5',
    colorBgContainer: '#fff',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
  },
  dark: {
    colorPrimary: '#1668dc',
    colorSuccess: '#49aa19',
    colorWarning: '#d89614',
    colorError: '#dc4446',
    colorInfo: '#1668dc',
    colorText: '#dcdcdc',
    colorTextSecondary: '#a6a6a6',
    colorBgLayout: '#000',
    colorBgContainer: '#141414',
    colorBorder: '#424242',
    colorBorderSecondary: '#303030',
  },
} as const satisfies Record<ColorScheme, Record<string, string>>;

/** Which CSS variable in tokens.css carries each palette entry. */
export const PALETTE_VARIABLES: Readonly<Record<keyof (typeof PALETTE)['light'], string>> = {
  colorPrimary: '--od-color-primary',
  colorSuccess: '--od-color-success',
  colorWarning: '--od-color-warning',
  colorError: '--od-color-error',
  colorInfo: '--od-color-info',
  colorText: '--od-color-text',
  colorTextSecondary: '--od-color-text-secondary',
  colorBgLayout: '--od-color-bg-layout',
  colorBgContainer: '--od-color-bg-container',
  colorBorder: '--od-color-border',
  colorBorderSecondary: '--od-color-border-secondary',
};

/** The ConfigProvider theme for a colour scheme. */
export function themeFor(scheme: ColorScheme): ThemeConfig {
  return {
    algorithm: scheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      ...PALETTE[scheme],
      fontFamily: 'var(--od-font-ui)',
      borderRadius: 6,
    },
  };
}
