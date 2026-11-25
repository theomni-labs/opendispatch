// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Negative tests for the lint rules that guard the project rules and 26.
// The fixture test requires that a forbidden import is REJECTED, not just that the repo is clean.

const root = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function ruleIds(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

async function messagesOf(code: string, file: string, ruleId: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === ruleId).map((m) => m.message);
}

describe('banned imports', () => {
  const screen = 'apps/web/src/app/[locale]/ops/page.tsx';
  const banned = 'opendispatch/no-banned-import';
  const bans = async (code: string, file: string): Promise<boolean> => (await ruleIds(code, file)).includes(banned);

  it('rejects fixture imports from a screen', async () => {
    expect(await bans("import cases from '../../../../../../fixtures/cases.json';\nexport default cases;\n", screen)).toBe(true);
  });

  it('rejects the demo store from a screen', async () => {
    expect(await bans("import { readStore } from '@/lib/data/internal/store';\nexport default readStore;\n", screen)).toBe(true);
  });

  it('rejects an api client from a screen', async () => {
    expect(await bans("import { client } from '@/lib/api-client/client';\nexport default client;\n", screen)).toBe(true);
  });

  it('allows the public data layer', async () => {
    expect(await bans("import { listCases } from '@/lib/data/cases';\nexport default listCases;\n", screen)).toBe(false);
    expect(await bans("import { listCases } from '../../../../lib/data/cases';\nexport default listCases;\n", screen)).toBe(false);
  });

  it('allows the data layer itself to read internals', async () => {
    const code = "import { readStore } from './internal/store';\nimport cases from '../../../../../fixtures/cases.json';\nimport fs from 'node:fs';\nexport default [readStore, cases, fs];\n";
    expect(await bans(code, 'apps/web/src/lib/data/cases.ts')).toBe(false);
    expect(await bans("import { a } from '../store';\nexport default a;\n", 'apps/web/src/lib/data/internal/x.ts')).toBe(false);
  });

  // Review finding: every row of the bypass table is a permanent negative test.
  describe('bypasses found in review', () => {
    const cases: Array<[string, string, string]> = [
      ['relative path from a sibling folder', "import { s } from '../data/internal/store';\nexport default s;\n", 'apps/web/src/lib/session/fake.ts'],
      ['relative path without lib/ in the string', "import { s } from './data/internal/store';\nexport default s;\n", 'apps/web/src/lib/fake.ts'],
      ['export * from the store', "export * from '../data/internal/store';\n", 'apps/web/src/lib/session/fake.ts'],
      ['named re-export from the store', "export { readAll } from '../data/internal/store';\n", 'apps/web/src/lib/session/fake.ts'],
      ['dynamic import of the exact banned string', "export const load = async () => await import('@/lib/data/internal/store');\n", 'apps/web/src/components/Fake.tsx'],
      ['dynamic import, relative', "export const load = () => import('../data/internal/store');\n", 'apps/web/src/lib/session/fake.ts'],
      ['dynamic import of a fixture', "export const load = () => import('../../../../fixtures/cases.json');\n", 'apps/web/src/components/Fake.tsx'],
      ['dynamic import with a template literal', 'export const load = (n: string) => import(`../data/internal/${n}`);\n', 'apps/web/src/lib/session/fake.ts'],
      ['require of the store', "const s = require('../data/internal/store');\nmodule.exports = s;\n", 'apps/web/src/lib/session/fake.js'],
      ['TypeScript import equals', "import s = require('../data/internal/store');\nexport default s;\n", 'apps/web/src/lib/session/fake.ts'],
      ['import type of the store', "import type { S } from '@/lib/data/internal/store';\nexport type T = S;\n", 'apps/web/src/components/Fake.ts'],
      ['a .jsx file', "import { s } from '@/lib/data/internal/store';\nexport default s;\n", 'apps/web/src/components/Fake.jsx'],
      ['a .js file', "import { s } from '@/lib/data/internal/store';\nexport default s;\n", 'apps/web/src/components/Fake.js'],
      ['a .mts file', "import { s } from '@/lib/data/internal/store';\nexport default s;\n", 'apps/web/src/components/Fake.mts'],
      ['a route handler .js file', "import { s } from '@/lib/data/internal/store';\nexport const GET = s;\n", 'apps/web/src/app/x/route.js'],
      ['an unnormalised path', "import { s } from '@/lib/data/./internal/store';\nexport default s;\n", 'apps/web/src/components/Fake.ts'],
      ['a path that climbs out and back in', "import { s } from '@/lib/session/../data/internal/store';\nexport default s;\n", 'apps/web/src/components/Fake.ts'],
      ['the store index', "import { s } from '@/lib/data/internal';\nexport default s;\n", 'apps/web/src/components/Fake.ts'],
      ['an api client under another name', "import { x } from '@/lib/api/client';\nexport default x;\n", 'apps/web/src/components/Fake.ts'],
      ['a relative api client', "import { x } from '../lib/api-client';\nexport default x;\n", 'apps/web/src/components/Fake.ts'],
      ['the test support helpers', "import { asRole } from '@/lib/data/test-support';\nexport default asRole;\n", 'apps/web/src/components/Fake.ts'],
      ['node:fs (reading fixtures directly)', "import fs from 'node:fs';\nexport default fs.readFileSync('fixtures/manifest.json');\n", 'apps/web/src/app/[locale]/fake/page.ts'],
      ['fs without the node: prefix', "import { readFileSync } from 'fs';\nexport default readFileSync;\n", 'apps/web/src/app/[locale]/fake/page.ts'],
      ['fs/promises', "import { readFile } from 'node:fs/promises';\nexport default readFile;\n", 'apps/web/src/app/[locale]/fake/page.ts'],
      ['dynamic import of node:fs', "export const load = () => import('node:fs');\n", 'apps/web/src/app/[locale]/fake/page.ts'],
      ['require of fs', "const fs = require('node:fs');\nmodule.exports = fs;\n", 'apps/web/src/app/[locale]/fake/page.js'],
      ['createRequire from node:module', "import { createRequire } from 'node:module';\nexport default createRequire;\n", 'apps/web/src/lib/session/fake.ts'],
      ['a fetch call (a screen reading over the network)', "export const load = () => fetch('https://example.invalid/cases');\n", 'apps/web/src/app/[locale]/fake/page.ts'],
    ];
    it.each(cases)('rejects %s', async (_name, code, file) => {
      expect(await bans(code, file)).toBe(true);
    });

    it('still lets the i18n loader import its own message files dynamically', async () => {
      const code = 'export const load = async (locale: string) => (await import(`../../messages/${locale}.json`)).default;\n';
      expect(await bans(code, 'apps/web/src/i18n/request.ts')).toBe(false);
    });

    it('lets tests read source files with node:fs but never the demo store', async () => {
      expect(await bans("import { readFileSync } from 'node:fs';\nexport default readFileSync;\n", 'apps/web/src/lib/access/purity.test.ts')).toBe(false);
      expect(await bans("import { s } from '../data/internal/store';\nexport default s;\n", 'apps/web/src/lib/access/x.test.ts')).toBe(true);
    });
  });

  // Review finding: what still escaped after the fix. Every case below is a permanent negative test, run
  // against the real config (eslint.config.mjs), the same as the table above.
  describe('bypasses found in review', () => {
    const fixtureImport = "import cases from '../../../../../../fixtures/cases.json';\nexport default cases;\n";
    const nonTest = 'apps/web/src/components/opendispatch/Fake.ts';
    const aTest = 'apps/web/src/components/opendispatch/fake.test.ts';

    describe('(a) inline directives cannot silence the rule', () => {
      const directives: Array<[string, string]> = [
        ['eslint-disable-next-line with the rule name', `// eslint-disable-next-line opendispatch/no-banned-import\n${fixtureImport}`],
        ['eslint-disable-next-line without a rule name', `// eslint-disable-next-line\n${fixtureImport}`],
        ['eslint-disable-line at the end of the import', "import cases from '../../../../../../fixtures/cases.json'; // eslint-disable-line opendispatch/no-banned-import\nexport default cases;\n"],
        ['a block eslint-disable with the rule name', `/* eslint-disable opendispatch/no-banned-import */\n${fixtureImport}`],
        ['a block eslint-disable of everything', `/* eslint-disable */\n${fixtureImport}`],
        ['a block eslint-disable ... eslint-enable pair', `/* eslint-disable opendispatch/no-banned-import */\n${fixtureImport}/* eslint-enable opendispatch/no-banned-import */\n`],
        ['an eslint configuration comment that turns the rule off', `/* eslint opendispatch/no-banned-import: off */\n${fixtureImport}`],
        ['an eslint-disable-next-line block comment', `/* eslint-disable-next-line opendispatch/no-banned-import */\n${fixtureImport}`],
      ];
      it.each(directives)('rejects the fixture import under %s', async (_name, code) => {
        expect(await bans(code, screen)).toBe(true);
      });

      it('reports the directive itself, so a stray one fails the build (--max-warnings 0)', async () => {
        const [result] = await eslint.lintText(`// eslint-disable-next-line opendispatch/no-banned-import\n${fixtureImport}`, { filePath: `${root}${screen}` });
        const directive = (result?.messages ?? []).filter((m) => m.ruleId === null && /noInlineConfig/.test(m.message));
        expect(directive).toHaveLength(1);
      });

      it('applies to test files too', async () => {
        // aTest sits one folder shallower than the screen, so the fixtures are one level fewer up.
        const importFromOpenDispatch = fixtureImport.replace('../../../../../../fixtures', '../../../../../fixtures');
        expect(await bans(`// eslint-disable-next-line opendispatch/no-banned-import\n${importFromOpenDispatch}`, aTest)).toBe(true);
        expect(await bans(`// eslint-disable-next-line opendispatch/no-banned-import\n${importFromOpenDispatch}`, nonTest)).toBe(true);
        expect(await bans("/* eslint-disable */\nexport default fetch('x');\n", nonTest)).toBe(true);
      });
    });

    describe('(b) test files', () => {
      const readsInTests: Array<[string, string]> = [
        ['fs.readFileSync with a literal path', "import fs from 'node:fs';\nexport default fs.readFileSync('fixtures/cases.json');\n"],
        ['fs.readFileSync with a template path', "import fs from 'node:fs';\nexport default fs.readFileSync(`${process.cwd()}/fixtures/cases.json`);\n"],
        ['a named readdirSync of the folder', "import { readdirSync } from 'node:fs';\nexport default readdirSync('fixtures');\n"],
        ['fs.promises.readFile of the demo state', "import fs from 'node:fs';\nexport default fs.promises.readFile('.demo-state/store.json');\n"],
        ['readFile from fs/promises with a relative path', "import { readFile } from 'node:fs/promises';\nexport default readFile('../../../../../fixtures/cases.json');\n"],
        ['createReadStream', "import { createReadStream } from 'node:fs';\nexport default createReadStream('fixtures/cases.json');\n"],
        ['a path.join whose segments name the folder', "import { readFileSync } from 'node:fs';\nimport path from 'node:path';\nexport default readFileSync(path.join(process.cwd(), 'fixtures', 'cases.json'));\n"],
        ['a computed method name', "import fs from 'node:fs';\nexport default fs['readFileSync']('fixtures/cases.json');\n"],
        ['a file URL', "import { readFileSync } from 'node:fs';\nexport default readFileSync(new URL('../../../../../fixtures/cases.json', import.meta.url));\n"],
        ['existsSync of the demo state', "import { existsSync } from 'node:fs';\nexport default existsSync('.demo-state');\n"],
      ];
      it.each(readsInTests)('rejects %s in a test file outside lib/data', async (_name, code) => {
        expect(await bans(code, aTest)).toBe(true);
        expect(await bans(code, 'apps/web/src/lib/access/x.spec.tsx')).toBe(true);
      });

      it('still lets a test read source files and other paths', async () => {
        const ok = [
          "import { readFileSync } from 'node:fs';\nexport default readFileSync(new URL('./Providers.tsx', import.meta.url), 'utf8');\n",
          "import { readdirSync } from 'node:fs';\nexport default readdirSync('apps/web/src');\n",
          "import fs from 'node:fs';\nimport path from 'node:path';\nexport default fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');\n",
        ];
        for (const code of ok) expect(await bans(code, aTest), code).toBe(false);
      });

      it('leaves lib/data tests free to read the fixtures they test', async () => {
        const code = "import fs from 'node:fs';\nexport default fs.readFileSync('fixtures/cases.json');\n";
        expect(await bans(code, 'apps/web/src/lib/data/forecast.test.ts')).toBe(false);
      });

      const testImports: Array<[string, string, string]> = [
        ['a .test module without its extension', "import { helper } from './helper.test';\nexport default helper;\n", 'apps/web/src/lib/access/x.ts'],
        ['a .test.ts module', "import { helper } from './helper.test.ts';\nexport default helper;\n", 'apps/web/src/lib/access/x.ts'],
        ['a .spec module', "import { helper } from './helper.spec';\nexport default helper;\n", 'apps/web/src/lib/access/x.ts'],
        ['a .test.tsx module through the @/ alias', "import { helper } from '@/lib/access/helper.test.tsx';\nexport default helper;\n", 'apps/web/src/components/opendispatch/Fake.ts'],
        ['a re-export of a test module', "export { helper } from './helper.test';\n", 'apps/web/src/lib/access/x.ts'],
        ['a dynamic import of a test module', "export const load = () => import('../access/helper.test');\n", 'apps/web/src/lib/session/x.ts'],
        ['a test module inside lib/data', "import { helper } from '@/lib/data/forecast.test';\nexport default helper;\n", 'apps/web/src/components/opendispatch/Fake.ts'],
      ];
      it.each(testImports)('rejects a production file that imports %s', async (_name, code, file) => {
        expect(await bans(code, file)).toBe(true);
      });

      it('lets a test file import another test module', async () => {
        expect(await bans("import { helper } from './helper.test';\nexport default helper;\n", 'apps/web/src/lib/access/x.test.ts')).toBe(false);
      });
    });

    describe('(c) process.getBuiltinModule and process.binding', () => {
      const viaProcess: Array<[string, string]> = [
        ['process.getBuiltinModule', "const fs = process.getBuiltinModule('node:fs');\nexport default fs;\n"],
        ['a computed getBuiltinModule', "export default process['getBuiltinModule']('node:fs');\n"],
        ['getBuiltinModule through globalThis.process', "export default globalThis.process.getBuiltinModule('node:fs');\n"],
        ['getBuiltinModule through an alias of process', "const p = process;\nexport default p.getBuiltinModule('node:fs');\n"],
        ['a destructured getBuiltinModule', "const { getBuiltinModule } = process;\nexport default getBuiltinModule('node:fs');\n"],
        ['process.binding', "export default process.binding('fs');\n"],
        ['process._linkedBinding', "export default process._linkedBinding('x');\n"],
        ['process.dlopen', "export default process.dlopen;\n"],
        ['process.mainModule', "export default process.mainModule;\n"],
        ['a computed member of process', "export const get = (name: string) => process[name];\n"],
      ];
      it.each(viaProcess)('rejects %s outside lib/data', async (_name, code) => {
        expect(await bans(code, nonTest)).toBe(true);
      });

      it('rejects process.getBuiltinModule and process.binding in a test file too', async () => {
        expect(await bans("export default process.getBuiltinModule('node:fs');\n", aTest)).toBe(true);
        expect(await bans("export default process.binding('fs');\n", aTest)).toBe(true);
      });

      it('still allows the ordinary uses of process', async () => {
        const ok = [
          "export const secret = process.env['DEMO_SESSION_SECRET'];\n",
          "export const cwd = process.cwd();\n",
          "export const server = typeof process !== 'undefined';\n",
        ];
        for (const code of ok) expect(await bans(code, nonTest), code).toBe(false);
        expect(await bans("const p = process;\nexport default p.env;\n", aTest)).toBe(false);
      });
    });

    describe('(d) the network globals as values, not only as calls', () => {
      const networkValues: Array<[string, string]> = [
        ['fetch held in a constant', "const f = fetch;\nexport default f;\n"],
        ['fetch handed to Reflect.apply', "export const go = () => Reflect.apply(fetch, undefined, ['https://example.invalid']);\n"],
        ['fetch bound', "export const f = fetch.bind(undefined);\n"],
        ['fetch in an array', "export const list = [fetch];\n"],
        ['globalThis.fetch', "export default globalThis.fetch;\n"],
        ['globalThis with a computed literal', "export default globalThis['fetch'];\n"],
        ['window with a computed literal, called', "export default window['fetch']('https://example.invalid');\n"],
        ['self.fetch called', "export default self.fetch('https://example.invalid');\n"],
        ['optional chaining on globalThis', "export default globalThis?.fetch?.('https://example.invalid');\n"],
        ['globalThis.window.fetch', "export default globalThis.window.fetch;\n"],
        ['a destructured fetch', "const { fetch: f } = globalThis;\nexport default f;\n"],
        ['globalThis held in a constant', "const g = globalThis;\nexport default g.fetch;\n"],
        ['a type assertion around globalThis', "export default (globalThis as typeof globalThis & { x: number }).fetch;\n"],
        ['a non-null assertion on the member', "export default globalThis.fetch!;\n"],
        ['a computed non-literal name on the global object', "export const get = (name: string) => globalThis[name];\n"],
        ['a computed name built from parts', "export default globalThis['fe' + 'tch'];\n"],
        ['XMLHttpRequest as a value', "export const X = XMLHttpRequest;\n"],
        ['new globalThis.XMLHttpRequest', "export default new globalThis.XMLHttpRequest();\n"],
        ['WebSocket held in a constant', "const W = WebSocket;\nexport default W;\n"],
        ['EventSource in an array', "export const list = [EventSource];\n"],
      ];
      it.each(networkValues)('rejects %s', async (_name, code) => {
        expect(await bans(code, nonTest)).toBe(true);
      });

      it('names the global in the message', async () => {
        const [message] = await messagesOf('const f = fetch;\nexport default f;\n', nonTest, banned);
        expect(message).toContain('fetch');
        expect(message).toContain('the project rules');
      });

      it('still allows a test file to use, stub and pass around the network globals', async () => {
        for (const code of [
          "const f = fetch;\nexport default f;\n",
          "export default globalThis.fetch;\n",
          "export default vi.stubGlobal('fetch', () => undefined);\n",
          "export default new WebSocket('ws://localhost');\n",
        ]) expect(await bans(code, aTest), code).toBe(false);
      });

      it('does not mistake a local variable or a type for the global', async () => {
        const ok = [
          "export const run = (fetch: (u: string) => string) => fetch('a');\n",
          "const fetch = (u: string) => u;\nexport default fetch('a');\n",
          "export type Socket = WebSocket;\n",
          "export type Fetcher = typeof fetch;\n",
          "export const has = typeof fetch === 'function';\n",
          "export const wide = typeof window === 'undefined' ? 0 : window.innerWidth;\n",
          "export const query = () => window.matchMedia('(min-width: 1px)');\n",
        ];
        for (const code of ok) expect(await bans(code, nonTest), code).toBe(false);
      });
    });

    describe('(e) an import by a path into packages/ui', () => {
      const viaVendor: Array<[string, string]> = [
        ['a relative path', "import { Button } from '../../../../../packages/ui/src/components/button';\nexport default Button;\n"],
        ['the @/ alias climbing out of src', "import { Button } from '@/../../../packages/ui/src/components/button';\nexport default Button;\n"],
        ['a bare packages/ specifier', "import { Button } from 'packages/ui/src/components/button';\nexport default Button;\n"],
        ['an absolute path', `import { Button } from '${root}packages/ui/src/components/button';\nexport default Button;\n`],
        ['a dynamic import', "export const load = () => import('../../../../../packages/ui/src/index');\n"],
        ['a re-export', "export * from '../../../../../packages/ui/src/index';\n"],
        ['a type import', "import type { Tone } from '../../../../../packages/ui/src/types';\nexport type T = Tone;\n"],
        ['a require', "const b = require('../../../../../packages/ui/src/index');\nexport default b;\n"],
      ];
      it.each(viaVendor)('rejects %s', async (_name, code) => {
        expect(await bans(code, nonTest)).toBe(true);
      });

      it('says UI is imported from the package only', async () => {
        const [message] = await messagesOf(viaVendor[0]![1], nonTest, banned);
        expect(message).toContain("'@opendispatch/ui'");
      });

      it('applies to test files as well', async () => {
        expect(await bans(viaVendor[0]![1], aTest)).toBe(true);
      });

      it('allows the package and paths that only look similar', async () => {
        const ok = [
          "import { Button } from '@opendispatch/ui';\nexport default Button;\n",
          "import { readTokens } from '@opendispatch/ui/tokens';\nexport default readTokens;\n",
          "import { list } from './packages-list';\nexport default list;\n",
        ];
        for (const code of ok) expect(await bans(code, nonTest), code).toBe(false);
      });
    });

    describe('(f) more Node modules that read files, run code or reach a network', () => {
      const modules = [
        'worker_threads', 'vm', 'os', 'dns', 'dns/promises', 'dgram', 'cluster', 'readline', 'readline/promises',
        'inspector', 'inspector/promises', 'v8', 'repl', 'sqlite', 'process',
      ];
      it.each(modules)('rejects node:%s and the bare name in a screen', async (name) => {
        expect(await bans(`import x from 'node:${name}';\nexport default x;\n`, nonTest)).toBe(true);
        expect(await bans(`import x from '${name}';\nexport default x;\n`, nonTest)).toBe(true);
        expect(await bans(`export const load = () => import('node:${name}');\n`, nonTest)).toBe(true);
      });

      it('leaves the Node modules that do no I/O alone', async () => {
        for (const name of ['crypto', 'path', 'url', 'zlib', 'perf_hooks', 'util', 'events']) {
          expect(await bans(`import x from 'node:${name}';\nexport default x;\n`, nonTest), name).toBe(false);
        }
      });
    });

    describe('(g) require, new URL and URL-shaped import specifiers', () => {
      const shapes: Array<[string, string]> = [
        ['require.context', "export const ctx = require.context('../data', true, /\\.json$/);\n"],
        ['require held as a value', "const r = require;\nexport default r('node:path');\n"],
        ['require.main', "export default require.main;\n"],
        ['module.require', "export default module.require('node:fs');\n"],
        ['new URL against import.meta.url', "export const u = new URL('../../../../../fixtures/cases.json', import.meta.url);\n"],
        ['new URL with a computed path against import.meta.url', "export const u = (p: string) => new URL(p, import.meta.url);\n"],
        ['an http import()', "export const load = () => import('http://example.invalid/x.js');\n"],
        ['an https import()', "export const load = () => import('https://example.invalid/x.js');\n"],
        ['a data: import()', "export const load = () => import('data:text/javascript,export default 1');\n"],
        ['a static import of an https URL', "import x from 'https://example.invalid/x.js';\nexport default x;\n"],
        ['a static import of a data: URL', "import 'data:text/javascript,globalThis.x = 1';\n"],
        ['a file: import()', "export const load = () => import('file:///etc/passwd');\n"],
        ['a protocol-relative import()', "export const load = () => import('//example.invalid/x.js');\n"],
        ['an https template with a static prefix', "export const load = (h: string) => import(`https://example.invalid/${h}.js`);\n"],
        ['a node: template with a static prefix', "export const load = (m: string) => import(`node:${m}`);\n"],
      ];
      it.each(shapes)('rejects %s', async (_name, code) => {
        expect(await bans(code, nonTest)).toBe(true);
      });

      it('rejects a URL-shaped import in a test file too, and require.context', async () => {
        expect(await bans("export const load = () => import('https://example.invalid/x.js');\n", aTest)).toBe(true);
        expect(await bans("export const load = () => import('data:text/javascript,export default 1');\n", aTest)).toBe(true);
        expect(await bans("export const ctx = require.context('../data');\n", aTest)).toBe(true);
      });

      it('still allows new URL in a test file, require.resolve and new URL against another base', async () => {
        expect(await bans("export const u = new URL('./x.ts', import.meta.url);\n", aTest)).toBe(false);
        expect(await bans("export const p = require.resolve('./x');\n", nonTest)).toBe(false);
        expect(await bans("export const u = new URL('/a', 'http://localhost');\n", nonTest)).toBe(false);
      });
    });

    // Not on the reviewer's list: code built from a string can name any global or module, past everything above.
    describe('(h) code built from a string', () => {
      const fromStrings: Array<[string, string]> = [
        ['eval', "export default eval(\"fetch('https://example.invalid')\");\n"],
        ['an indirect eval', "export default (0, eval)('1');\n"],
        ['globalThis.eval', "export default globalThis.eval('1');\n"],
        ['new Function', "export default new Function('return fetch')();\n"],
        ['Function called without new', "export default Function('return fetch')();\n"],
        ['setTimeout with a string', "export default setTimeout('fetch(1)', 0);\n"],
      ];
      it.each(fromStrings)('rejects %s', async (_name, code) => {
        const ids = await ruleIds(code, nonTest);
        expect(ids.some((id) => id === 'no-eval' || id === 'no-implied-eval' || id === 'no-new-func')).toBe(true);
      });
    });
  });
});

describe('direction and UI import rules', () => {
  const file = 'apps/web/src/components/opendispatch/Example.tsx';
  const wrap = (style: string): string =>
    `export function Example() {\n  return <div style={${style}} />;\n}\n`;

  it('rejects physical direction in style props and accepts logical ones', async () => {
    expect(await ruleIds(wrap('{ marginLeft: 4 }'), file)).toContain('opendispatch/no-physical-css');
    expect(await ruleIds(wrap("{ textAlign: 'right' }"), file)).toContain('opendispatch/no-physical-css');
    expect(await ruleIds(wrap('{ marginInlineStart: 4 }'), file)).not.toContain('opendispatch/no-physical-css');
  });

  it.each([
    ["import Button from 'antd/es/button';\nexport default Button;\n"],
    ["import Trigger from '@rc-component/trigger';\nexport default Trigger;\n"],
    ["import Table from 'rc-table';\nexport default Table;\n"],
    ["import * as echarts from 'echarts';\nexport default echarts;\n"],
    ["import { Button } from '@opendispatch/ui/src/components/button';\nexport default Button;\n"],
  ])('rejects a UI import below the package names: %s', async (code) => {
    expect(await ruleIds(code, file)).toContain('no-restricted-imports');
  });

  it('accepts the UI packages by name', async () => {
    const code = [
      "import { Button } from '@opendispatch/ui';",
      "import { LineChart } from '@opendispatch/ui/charts';",
      "import { Flex } from 'antd';",
      "import { PlusOutlined } from '@ant-design/icons';",
      'export const all = [Button, LineChart, Flex, PlusOutlined];',
      '',
    ].join('\n');
    expect(await ruleIds(code, file)).not.toContain('no-restricted-imports');
  });
});
