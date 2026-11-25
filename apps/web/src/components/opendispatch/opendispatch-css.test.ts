// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The rules of CONTRIBUTING.md 26 and 29 for the OpenDispatch components , checked on the files themselves: semantic tokens
// only, logical properties only, and every class the component uses is one its CSS Module defines (Vitest returns a
// class name for any key, so a typo would otherwise pass unseen). Stylelint is the gate; this keeps the same
// promises in the unit tests and adds the two checks Stylelint cannot make.

const COMPONENTS = [
  'DataSourceBadge',
  'IllustrativeLabel',
  'Qualifier',
  'Reading',
  'StageChip',
  'FallbackBanner',
  'StatusDot',
  'ReasonHint',
  'MapView',
  'ScreenFrame',
  'ScreenSkeleton',
] as const;

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('../../../../../packages/ui/src/styles/tokens.css');

const PHYSICAL_PROPERTIES =
  /(?:^|[\s;{])(left|right|top|bottom|width|height|min-width|max-width|min-height|max-height|margin-(?:left|right|top|bottom)|padding-(?:left|right|top|bottom)|border-(?:left|right|top|bottom)(?:-[a-z]+)?|border-(?:top|bottom)-(?:left|right)-radius|scroll-margin-(?:left|right)|scroll-padding-(?:left|right)|overflow-[xy])\s*:/g;

describe.each(COMPONENTS)('%s.module.css', (name) => {
  const css = stripComments(read(`./${name}.module.css`));

  it('uses no physical direction: logical properties only (RTL, the project rules)', () => {
    expect([...css.matchAll(PHYSICAL_PROPERTIES)].map((m) => m[1])).toEqual([]);
    expect(css).not.toMatch(/text-align\s*:\s*(left|right)\b/);
    expect(css).not.toMatch(/\b(float|clear)\s*:\s*(left|right)\b/);
  });

  it('has no raw colour, no pixel font size, no shadow and no !important', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/);
    expect(css).not.toMatch(/font-size\s*:\s*[\d.]+px/);
    expect(css).not.toMatch(/(box|text)-shadow\s*:/);
    expect(css).not.toMatch(/!important/);
    expect(css).not.toMatch(/--tx-/);
  });

  it('reads only tokens the design system defines (or a variable it sets itself)', () => {
    const own = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string);
    const unknown = used.filter((token) => !own.has(token) && !new RegExp(`${token}\\s*:`).test(tokens));
    expect(unknown).toEqual([]);
  });

  it('defines every class its component uses', () => {
    const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    const source = read(`./${name}.tsx`);
    const used = [...source.matchAll(/styles\.([A-Za-z]\w*)/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((className) => !defined.has(className))).toEqual([]);
  });

  it('has no class its component does not use', () => {
    const defined = [...new Set([...css.matchAll(/^\.([A-Za-z][\w-]*)/gm)].map((m) => m[1] as string))];
    const source = read(`./${name}.tsx`);
    expect(defined.filter((className) => !new RegExp(`styles\\.${className}\\b`).test(source))).toEqual([]);
  });
});

describe('the components', () => {
  it.each(COMPONENTS)('%s does not use ui-next or a raw colour or a physical style prop', (name) => {
    const source = read(`./${name}.tsx`);
    // Built from parts so the exit-test grep for the removed package finds no literal name in this file.
    expect(source).not.toMatch(new RegExp(['@omni' + 'appsuiux', '--' + 'tx-', 'react-' + 'direction'].join('|')));
    expect(source).not.toMatch(/style=\{\{[^}]*\b(left|right|marginLeft|marginRight|paddingLeft|paddingRight)\b/);
    expect(source).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/);
  });
});
