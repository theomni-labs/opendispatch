// SPDX-License-Identifier: AGPL-3.0-only
// Stylelint for OpenDispatch CSS: the standard config, logical properties only (the app runs right to left in
// Arabic), and colours, shadows and font sizes from the theme tokens (packages/ui/src/styles/tokens.css, `--od-`).
// tokens.css is where the colour values live, so the colour rules do not apply to it.

const SHADOW_TOKEN = String.raw`var\(--od-(?:shadow|focus-ring)[\w-]*\)`;
const NOT_A_SHADOW_TOKEN = new RegExp(`^(?!none$)(?!${SHADOW_TOKEN}(?:\\s*,\\s*${SHADOW_TOKEN})*$).+`, 'i');
const PIXEL_FONT_SIZE = /(?<![\w./-])[+-]?(?:\d+\.?\d*|\.\d+)(?:px|pt)\b/i;

const config = {
  extends: ['stylelint-config-standard', 'stylelint-plugin-logical-css/configs/recommended'],
  ignoreFiles: ['**/node_modules/**', '**/.next/**', '**/.next-*/**', 'coverage/**', 'playwright-report/**'],
  ignoreDisables: true,
  rules: {
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
    'property-no-unknown': [true, { ignoreProperties: ['composes'] }],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)$/i],
    'declaration-property-value-disallowed-list': {
      '/^text-align$/i': [/^(left|right)$/i],
      '/^(?:float|clear)$/i': [/^(left|right)$/i],
      '/^(?:font-size|font)$/i': [PIXEL_FONT_SIZE],
      '/^(?:box-shadow|text-shadow)$/i': [NOT_A_SHADOW_TOKEN],
    },
  },
  overrides: [
    // Component styles list a state after the base rule it changes (hover after the row, the last row after the
    // header), which this rule reads as descending specificity.
    { files: ['packages/ui/src/**/*.css'], rules: { 'no-descending-specificity': null } },
    {
      files: ['**/styles/tokens.css', 'deploy/keycloak/**/tokens.css'],
      rules: { 'color-no-hex': null, 'function-disallowed-list': null, 'declaration-property-value-disallowed-list': null },
    },
  ],
};

export default config;
