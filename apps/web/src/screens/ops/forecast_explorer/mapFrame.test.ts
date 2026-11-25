// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./ForecastExplorer.module.css', import.meta.url)), 'utf8');

// maplibregl-map must not win: 0 px high map
describe('demand map frame', () => {
  it('positions the plot with a two-class selector, so MapLibre cannot reset it', () => {
    const rule = /\.mapLibreFrame\s*>\s*\.mapLibrePlot\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'a .mapLibreFrame > .mapLibrePlot rule').not.toBeNull();
    expect(rule?.[1]).toMatch(/position:\s*absolute/);
    expect(rule?.[1]).toMatch(/inset:\s*0/);
  });

  it('keeps no single-class plot rule that MapLibre could override', () => {
    expect(css).not.toMatch(/(^|\n)\.mapLibrePlot\s*\{/);
  });
});
