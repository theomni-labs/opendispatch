#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Theme assets: pnpm keycloak:theme [--check]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '../..');
export const THEME = path.join(ROOT, 'deploy/keycloak/themes/opendispatch/login/resources');
const TOKENS = path.join(ROOT, 'packages/ui/src/styles/tokens.css');
const FONTSOURCE = path.join(ROOT, 'apps/web/node_modules/@fontsource');
const WEIGHTS = [400, 500, 600, 700];
const FAMILIES = [
  { pkg: 'figtree', subset: 'latin', css: (w) => `latin-${w}.css` },
  { pkg: 'ibm-plex-sans-arabic', subset: 'arabic', css: (w) => `${w}.css` },
];

const HEADER = '/* Generated: pnpm keycloak:theme */\n';

// Light block only: the login pages are light.
function tokensCss() {
  const src = fs.readFileSync(TOKENS, 'utf8');
  const cut = src.indexOf('/* ---------- Dark theme');
  if (cut < 0) throw new Error('tokens.css: the dark theme marker moved');
  return `${HEADER}${src.slice(0, cut).trimEnd()}\n`;
}

function fontFace(pkg, subset, weight) {
  const css = fs.readFileSync(path.join(FONTSOURCE, pkg, FAMILIES.find((f) => f.pkg === pkg).css(weight)), 'utf8');
  const file = `${pkg}-${subset}-${weight}-normal.woff2`;
  const block = css.split('@font-face').find((b) => b.includes(file));
  if (block === undefined) throw new Error(`${pkg} ${weight}: no ${subset} face`);
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
  const family = /font-family:\s*([^;]+);/.exec(block)[1];
  const lines = [
    '@font-face {',
    `  font-family: ${family};`,
    '  font-style: normal;',
    '  font-display: swap;',
    `  font-weight: ${String(weight)};`,
    `  src: url("../fonts/${file}") format("woff2");`,
    ...(range === undefined ? [] : [`  unicode-range: ${range};`]),
    '}',
  ];
  return { file, css: lines.join('\n') };
}

/** Copied theme files: path -> contents. */
export function expectedAssets() {
  const out = new Map();
  out.set('css/tokens.css', tokensCss());
  const faces = [];
  for (const { pkg, subset } of FAMILIES) {
    for (const w of WEIGHTS) {
      const face = fontFace(pkg, subset, w);
      faces.push(face.css);
      out.set(`fonts/${face.file}`, fs.readFileSync(path.join(FONTSOURCE, pkg, 'files', face.file)));
    }
    out.set(`fonts/LICENSE-${pkg}.txt`, fs.readFileSync(path.join(FONTSOURCE, pkg, 'LICENSE')));
  }
  out.set('css/fonts.css', `${HEADER}${faces.join('\n\n')}\n`);
  return out;
}

/** Paths whose contents differ from their source. */
export function staleAssets() {
  const stale = [];
  for (const [rel, want] of expectedAssets()) {
    const file = path.join(THEME, rel);
    if (!fs.existsSync(file) || !Buffer.from(want).equals(fs.readFileSync(file))) stale.push(rel);
  }
  return stale;
}

if (process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--check')) {
    const stale = staleAssets();
    if (stale.length > 0) {
      console.error(`theme assets out of date: ${stale.join(', ')} (run node scripts/keycloak/theme-assets.mjs)`);
      process.exit(1);
    }
    console.log('theme assets up to date');
  } else {
    for (const [rel, data] of expectedAssets()) {
      fs.mkdirSync(path.dirname(path.join(THEME, rel)), { recursive: true });
      fs.writeFileSync(path.join(THEME, rel), data);
    }
    console.log(`wrote ${THEME}`);
  }
}
