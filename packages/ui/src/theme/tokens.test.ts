// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_VARIABLES, themeFor } from './palette';
import { readTokens } from './tokens';

const css = readFileSync(path.join(import.meta.dirname, '../styles/tokens.css'), 'utf8');
const [light = '', dark = ''] = css.split('/* ---------- Dark theme');
const valueIn = (block: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();

describe('theme tokens', () => {
  it('give Ant Design the same colours the CSS variables carry, in light and dark', () => {
    for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
      expect(valueIn(light, variable), variable).toBe(PALETTE.light[key as keyof typeof PALETTE.light]);
      expect(valueIn(dark, variable), variable).toBe(PALETTE.dark[key as keyof typeof PALETTE.dark]);
    }
  });

  it('define the dark theme for the system setting and for data-theme="dark" alike', () => {
    const blocks = dark.split(':root[data-theme="dark"]');
    expect(blocks).toHaveLength(2);
    const names = (block: string) => [...block.matchAll(/(--od-[\w-]+):/g)].map((m) => m[1]).sort();
    expect(names(blocks[0] ?? '')).toEqual(names(blocks[1] ?? ''));
    expect(names(blocks[0] ?? '').length).toBeGreaterThan(50);
  });

  it('use the Ant Design dark algorithm for dark', () => {
    expect(themeFor('dark').algorithm).not.toBe(themeFor('light').algorithm);
  });

  it('read custom properties from the page and refuse other names', () => {
    document.documentElement.style.setProperty('--od-heat-1', '#e6f4ff');
    expect(readTokens(['--od-heat-1', '--od-missing'])).toEqual({ '--od-heat-1': '#e6f4ff', '--od-missing': '' });
    expect(() => readTokens(['color'])).toThrow(/custom property/);
  });
});
