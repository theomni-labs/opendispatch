// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import opendispatch from './tools/eslint-rules/index.mjs';

const DATA_LAYER = 'apps/web/src/lib/data/**';

// the project rules: screens get data only through apps/web/src/lib/data/. Nothing outside that folder
// imports fixtures, the demo store or an api client, reads files, or fetches. The rule
// opendispatch/no-banned-import compares resolved paths, covers dynamic import(), require(), re-exports and
// every source extension. Keep it on. It only holds if it cannot be switched off from inside a file, so
// `linterOptions.noInlineConfig` below makes ESLint ignore (and warn about) every `eslint-disable` and
// `eslint` comment. Nothing in the repository uses one.
const SOURCE_FILES = 'apps/web/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '.remember/**',
    '**/.next/**',
    '**/.next-*/**', // per-agent build outputs (NEXT_DIST_DIR), never committed
    'apps/web/src/lib/types/**',
    'fixtures/**',
    'coverage/**',
    '.demo-state/**',
    'playwright-report/**',
    'test-results/**',
    'e2e-output/**',
    'docs/mockups/dist/**',
    '**/next-env.d.ts',
    'apps/web/public/maplibre/**', // vendored, minified maplibre-gl worker files
  ]),
  { linterOptions: { noInlineConfig: true } },
  ...nextVitals,
  ...nextTs,
  {
    settings: { next: { rootDir: 'apps/web' } },
    rules: { '@next/next/no-html-link-for-pages': 'off' }, // App Router only, no pages directory
  },
  {
    files: [SOURCE_FILES],
    ignores: [DATA_LAYER, 'apps/web/src/lib/types/**'],
    plugins: { opendispatch },
    rules: {
      'opendispatch/no-banned-import': 'error',
      // UI comes from '@opendispatch/ui' (and its subpaths) or 'antd' and '@ant-design/icons' by their package names,
      // never from the libraries under them or from files inside a package.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['antd/es/*', 'antd/lib/*', 'rc-*', '@rc-component/*', '@ant-design/cssinjs*', 'echarts', 'echarts/*', '@opendispatch/ui/src/*'],
              message: "Import UI from '@opendispatch/ui' (charts from '@opendispatch/ui/charts') or from 'antd' by its package name.",
            },
          ],
        },
      ],
      // Code built from a string can name any global or module, so the rule above could not see it.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { opendispatch },
    rules: {
      'opendispatch/no-physical-css': 'error',
    },
  },
]);
