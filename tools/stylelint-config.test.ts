// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import config from '../stylelint.config.mjs';

// The Stylelint config accepts token-only, logical-only CSS Modules and rejects raw colours, physical directions,
// pixel font sizes and shadows that are not theme tokens.

const root = fileURLToPath(new URL('../', import.meta.url));

async function rules(css: string, file = 'apps/web/src/components/opendispatch/example.module.css'): Promise<string[]> {
  const { results } = await stylelint.lint({ code: css, codeFilename: `${root}${file}`, config });
  return (results[0]?.warnings ?? []).map((w) => w.rule);
}

const wrap = (declaration: string): string => `.example {\n  ${declaration};\n}\n`;

describe('Stylelint config', () => {
  it('accepts theme tokens, logical properties and CSS Module syntax', async () => {
    const css = `.example {
  inline-size: 100%;
  margin-inline-start: var(--od-space-8);
  padding-block: var(--od-space-12);
  color: var(--od-color-text-heading);
  font-size: var(--od-font-size-14);
  text-align: start;
  box-shadow: var(--od-shadow-sm), var(--od-focus-ring);
}

:global(.other) .example {
  composes: base from './base.module.css';
}
`;
    expect(await rules(css)).toEqual([]);
  });

  it.each([
    ['color: #fff', 'color-no-hex'],
    ['color: red', 'color-named'],
    ['color: rgb(0 0 0)', 'function-disallowed-list'],
    ['font-size: 10px', 'declaration-property-value-disallowed-list'],
    ['box-shadow: 0 1px 2px black', 'declaration-property-value-disallowed-list'],
    ['text-align: right', 'declaration-property-value-disallowed-list'],
    ['float: left', 'declaration-property-value-disallowed-list'],
  ])('rejects %s', async (declaration, rule) => {
    expect(await rules(wrap(declaration))).toContain(rule);
  });

  it.each([['margin-left: 4px'], ['padding-right: 4px'], ['left: 0'], ['width: 10px'], ['border-left: 1px solid']])(
    'rejects the physical property in %s',
    async (declaration) => {
      const found = await rules(wrap(declaration));
      expect(found.some((rule) => rule.startsWith('logical-css/'))).toBe(true);
    },
  );

  it('lets the token file hold the colour values', async () => {
    expect(await rules(':root {\n  --od-color-primary: #1677ff;\n}\n', 'packages/ui/src/styles/tokens.css')).toEqual([]);
  });
});
