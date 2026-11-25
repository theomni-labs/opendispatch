// SPDX-License-Identifier: AGPL-3.0-only
// Local ESLint rules. no-physical-css catches what Stylelint cannot see: physical directions written in TSX style
// props (the app also runs right to left). no-banned-import keeps data access in apps/web/src/lib/data/ and UI
// imports on the package names.

import path from 'node:path';


const PHYSICAL_KEYS = new Set([
  'left',
  'right',
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'paddingRight',
  'scrollMarginLeft',
  'scrollMarginRight',
  'scrollPaddingLeft',
  'scrollPaddingRight',
  'borderLeft',
  'borderRight',
  'borderLeftWidth',
  'borderRightWidth',
  'borderLeftColor',
  'borderRightColor',
  'borderLeftStyle',
  'borderRightStyle',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
]);
const PHYSICAL_VALUE_KEYS = new Set(['textAlign', 'float', 'clear']);

const keyName = (property) => {
  if (property.type !== 'Property') return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
};

const stringValue = (node) => {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
  return null;
};

/** JSX `style={{ ... }}` object, or any object literal handed to `style`. */
const styleObjects = (context, visit) => ({
  JSXAttribute(node) {
    if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return;
    const value = node.value;
    if (value?.type !== 'JSXExpressionContainer') return;
    if (value.expression.type === 'ObjectExpression') visit(value.expression);
  },
});

export const noPhysicalCss = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      physical: 'Physical direction property "{{name}}" in a style prop. Use the logical one (inline-start, inline-end, block-start, block-end).',
      physicalValue: '"{{name}}: {{value}}" is a physical direction. Use start or end.',
    },
  },
  create(context) {
    return styleObjects(context, (object) => {
      for (const property of object.properties) {
        const name = keyName(property);
        if (name === null) continue;
        if (PHYSICAL_KEYS.has(name)) context.report({ node: property, messageId: 'physical', data: { name } });
        if (PHYSICAL_VALUE_KEYS.has(name)) {
          const value = stringValue(property.value);
          if (value === 'left' || value === 'right') {
            context.report({ node: property, messageId: 'physicalValue', data: { name, value } });
          }
        }
      }
    });
  },
};

// the project rules: screens get data only through apps/web/src/lib/data/. The rule is applied (in
// eslint.config.mjs) to every source file under apps/web/src except lib/data itself. It compares RESOLVED
// paths, so '../data/internal/store', '@/lib/data/./internal/store' and a dynamic import() all count.
// eslint.config.mjs also sets linterOptions.noInlineConfig, so an inline `eslint-disable` cannot switch it off.
const SRC = 'apps/web/src';
const RULE_1 = 'the project rules';
const BANNED_ZONES = [
  { path: 'fixtures', what: 'Fixtures are read only inside apps/web/src/lib/data/. Call a data layer function instead.' },
  { path: '.demo-state', what: 'The demo state is reached only through apps/web/src/lib/data/.' },
  { path: `${SRC}/lib/data/internal`, what: 'The demo store and fixture loader are internal to apps/web/src/lib/data/. Use its public functions.' },
  { path: `${SRC}/lib/data/test-support`, what: 'test-support imports the test runner and is for lib/data tests only.' },
  { path: `${SRC}/lib/api-client`, what: 'An api client is reached only through apps/web/src/lib/data/.' },
  { path: `${SRC}/lib/api`, what: 'An api client is reached only through apps/web/src/lib/data/.' },
  {
    path: 'packages/ui/src',
    what: "UI components are imported from '@opendispatch/ui' (or 'antd'), never by a path into packages/ui.",
  },
];
// Node modules that read files, start processes or threads, run code, or reach a network. Screens import none of them
// (tests may, to read source files: a test still may not read the fixtures or the demo state, see FS_READERS).
const NODE_IO = new Set([
  'fs', 'fs/promises', 'child_process', 'http', 'https', 'http2', 'net', 'tls', 'module',
  'worker_threads', 'vm', 'os', 'dns', 'dns/promises', 'dgram', 'cluster', 'readline', 'readline/promises',
  'inspector', 'inspector/promises', 'v8', 'repl', 'sqlite', 'process',
]);
const NETWORK_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);
// Members of `process` and `module` that load native code or other modules, or hand out the module loader.
const PROCESS_DENIED = new Set(['binding', 'getBuiltinModule', 'dlopen', '_linkedBinding', 'mainModule']);
const MODULE_DENIED = new Set(['require', 'constructor']);
// Code loaded from a URL or from inline data, and the protocol-relative form.
const URL_SPECIFIER = /^(?:https?:|data:|file:|blob:|\/\/)/i;
const TEST_MODULE = /\.(?:test|spec)(?:\.[cm]?[jt]sx?)?$/;
// The fs functions a test uses to read, and the paths a test outside lib/data must not read.
const FS_READERS = /^(?:readFile|readdir|createReadStream|open|opendir|stat|lstat|access|exists|readlink|realpath|cp|glob|watch|watchFile|copyFile|readv)(?:Sync)?$/;
const DATA_PATH = /fixtures|\.demo-state/i;
const TS_WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression']);

const toPosix = (p) => p.split(path.sep).join('/');
const isTestFile = (filename) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename);

/** Repo-relative resolved path of an import specifier, or null for a package name. */
const resolveSpecifier = (spec, filename, cwd) => {
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    return toPosix(path.relative(cwd, path.resolve(path.dirname(filename), spec)));
  }
  if (spec.startsWith('@/')) return toPosix(path.relative(cwd, path.resolve(cwd, SRC, spec.slice(2))));
  if (path.isAbsolute(spec)) return toPosix(path.relative(cwd, path.normalize(spec)));
  return null;
};

const zoneOf = (rel) => BANNED_ZONES.find((zone) => rel === zone.path || rel.startsWith(`${zone.path}/`) || rel.startsWith(`${zone.path}.`));
// A dynamic path whose static prefix could lead into a banned zone.
const zoneAhead = (rel) => BANNED_ZONES.find((zone) => zone.path.startsWith(rel));
// A template with a static prefix that could still name an I/O module: `node:${x}`, `fs/${x}`.
const mayReachIo = (prefix) => prefix.startsWith('node:') || (/^[a-z]/.test(prefix) && [...NODE_IO].some((name) => name.startsWith(prefix)));

const staticSpecifier = (node) => {
  if (!node) return { kind: 'dynamic' };
  if (node.type === 'Literal' && typeof node.value === 'string') return { kind: 'static', value: node.value };
  if (node.type === 'TemplateLiteral') {
    const head = node.quasis[0]?.value.cooked ?? '';
    return node.expressions.length === 0 ? { kind: 'static', value: head } : { kind: 'prefix', value: head };
  }
  return { kind: 'dynamic' };
};

/** The property a member expression names: `x.name`, `x['name']`, or dynamic. */
const memberKey = (member) => {
  if (!member.computed) return member.property.type === 'Identifier' ? { kind: 'static', value: member.property.name } : { kind: 'dynamic' };
  const spec = staticSpecifier(member.property);
  return spec.kind === 'static' ? spec : { kind: 'dynamic' };
};

/** Climbs out of `x as T`, `x!`, `<T>x` and `x satisfies T`, which do not change what x is. */
const unwrap = (node) => {
  let current = node;
  while (current.parent && TS_WRAPPERS.has(current.parent.type) && current.parent.expression === current) current = current.parent;
  return current;
};

const isTypeOf = (use) => use.parent?.type === 'UnaryExpression' && use.parent.operator === 'typeof';

/** True for `typeof x` written in a type position and for a reference that only names a type. */
const isTypeOnlyReference = (ref) => {
  if (ref.isTypeReference === true && ref.isValueReference !== true) return true;
  let node = ref.identifier;
  while (node.parent?.type === 'TSQualifiedName') node = node.parent;
  return node.parent?.type === 'TSTypeQuery';
};

const findVariable = (scope, name) => {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
};

export const noBannedImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      zone: `{{what}} ({{ref}})`,
      io: `"{{name}}" is I/O. Only apps/web/src/lib/data/ reads files or processes; screens call a data layer function (${RULE_1}).`,
      network: `{{name}} reaches the network. Only apps/web/src/lib/data/ fetches data; screens call a data layer function (${RULE_1}).`,
      dynamic: `This import path is not static, so the banned-import rule cannot check it. Use a literal path or a template with a static prefix outside lib/data (${RULE_1}).`,
      url: `"{{name}}" loads code from a URL or from inline data. Import a package or a file in the repository (${RULE_1}).`,
      testImport: `"{{name}}" is a test module, and a non-test file imports it. Test files may read files and stub the network, so production code must not import them (${RULE_1}).`,
      testRead: `A test outside lib/data reads "{{name}}". Tests reach the fixtures and the demo state only through apps/web/src/lib/data/ (${RULE_1}).`,
      processApi: `"{{name}}" loads native code or another module. Only apps/web/src/lib/data/ does that (${RULE_1}).`,
      processValue: `The process object is used as a value here, which hides what is read from it. Name the member: process.env.X (${RULE_1}).`,
      globalValue: `The global object "{{name}}" is used as a value or with a computed name, which hides which global is reached. Name the member: window.matchMedia (${RULE_1}).`,
      requireValue: `"{{name}}" is used other than as a direct require('...') call, which hides what is loaded (${RULE_1}).`,
      newUrl: `new URL(..., import.meta.url) points at a file next to this source. A screen gets its data from apps/web/src/lib/data/ (${RULE_1}).`,
    },
  },
  create(context) {
    const filename = context.filename;
    const cwd = context.cwd;
    const sourceCode = context.sourceCode;
    const inTest = isTestFile(filename);

    const checkSpecifier = (node, spec) => {
      if (spec.kind === 'dynamic') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }
      const isPrefix = spec.kind === 'prefix';
      const raw = spec.value;
      if (URL_SPECIFIER.test(raw)) {
        context.report({ node, messageId: 'url', data: { name: raw } });
        return;
      }
      const bare = raw.startsWith('node:') ? raw.slice(5) : raw;
      if (!inTest && (isPrefix ? mayReachIo(raw) : NODE_IO.has(bare))) {
        context.report({ node, messageId: 'io', data: { name: raw } });
        return;
      }
      if (/(^|\/)api-client(\/|$)/.test(raw)) {
        context.report({ node, messageId: 'zone', data: { what: 'An api client is reached only through apps/web/src/lib/data/.', ref: RULE_1 } });
        return;
      }
      const rel = resolveSpecifier(raw, filename, cwd) ?? toPosix(path.relative(cwd, path.resolve(cwd, raw)));
      const hit = zoneOf(rel) ?? (isPrefix ? zoneAhead(rel) : undefined);
      if (hit) {
        context.report({ node, messageId: 'zone', data: { what: hit.what, ref: hit.ref ?? RULE_1 } });
        return;
      }
      if (!inTest && !isPrefix && TEST_MODULE.test(rel)) context.report({ node, messageId: 'testImport', data: { name: raw } });
    };

    const fromSource = (node) => {
      if (node.source) checkSpecifier(node.source, staticSpecifier(node.source));
    };

    // Does this expression name the fixtures or the demo state, directly or through a constant it reads?
    const namesDataPath = (node, scope, depth = 0) => {
      if (DATA_PATH.test(sourceCode.getText(node))) return true;
      if (depth >= 2) return false;
      for (const token of sourceCode.getTokens(node)) {
        if (token.type !== 'Identifier') continue;
        for (const def of findVariable(scope, token.value)?.defs ?? []) {
          if (def.type === 'Variable' && def.node.init && namesDataPath(def.node.init, scope, depth + 1)) return true;
        }
      }
      return false;
    };

    const isImportMetaUrl = (node) =>
      node?.type === 'MemberExpression' && node.object.type === 'MetaProperty' && node.object.meta.name === 'import' &&
      node.object.property.name === 'meta' && memberKey(node).value === 'url';

    // `process` and `module`: the members that load native code or another module. The process object as a bare value
    // hides which member is read, so it is refused in non-test files.
    const checkProcess = (expr) => {
      const use = unwrap(expr);
      if (isTypeOf(use)) return;
      if (use.parent?.type === 'MemberExpression' && use.parent.object === use) {
        const key = memberKey(use.parent);
        if (key.kind === 'dynamic' || PROCESS_DENIED.has(key.value)) {
          const name = key.kind === 'dynamic' ? 'process[...]' : `process.${key.value}`;
          context.report({ node: use.parent, messageId: 'processApi', data: { name } });
        }
        return;
      }
      if (!inTest) context.report({ node: use, messageId: 'processValue' });
    };
    const checkModule = (expr) => {
      const use = unwrap(expr);
      if (isTypeOf(use)) return;
      if (use.parent?.type === 'MemberExpression' && use.parent.object === use) {
        const key = memberKey(use.parent);
        if (key.kind === 'dynamic' || MODULE_DENIED.has(key.value)) {
          context.report({ node: use.parent, messageId: 'requireValue', data: { name: key.kind === 'dynamic' ? 'module[...]' : `module.${key.value}` } });
        }
        return;
      }
      context.report({ node: use, messageId: 'requireValue', data: { name: 'module' } });
    };
    const checkRequire = (expr) => {
      const use = unwrap(expr);
      const parent = use.parent;
      if (parent?.type === 'CallExpression' && parent.callee === use) return; // require('...'): checked as an import
      if (parent?.type === 'MemberExpression' && parent.object === use) {
        const key = memberKey(parent);
        if (key.kind === 'static' && key.value === 'resolve') return;
        const name = key.kind === 'dynamic' ? 'require[...]' : `require.${key.value}`;
        context.report({ node: parent, messageId: 'requireValue', data: { name } });
        return;
      }
      if (!isTypeOf(use)) context.report({ node: use, messageId: 'requireValue', data: { name: 'require' } });
    };
    // window, globalThis, self, global: a named member that is not a network global is fine. Test files may use the network
    // globals, but still cannot reach `process` through the global object.
    const checkGlobalObject = (expr, name) => {
      const use = unwrap(expr);
      if (isTypeOf(use)) return;
      const parent = use.parent;
      if (parent?.type === 'MemberExpression' && parent.object === use) {
        const key = memberKey(parent);
        if (key.kind === 'static' && GLOBAL_OBJECTS.has(key.value)) checkGlobalObject(parent, name);
        else if (key.kind === 'static' && key.value === 'process') checkProcess(parent);
        else if (inTest) return;
        else if (key.kind === 'dynamic') context.report({ node: parent, messageId: 'globalValue', data: { name } });
        else if (NETWORK_GLOBALS.has(key.value)) context.report({ node: parent, messageId: 'network', data: { name: key.value } });
        return;
      }
      if (!inTest) context.report({ node: use, messageId: 'globalValue', data: { name } });
    };

    return {
      ImportDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ImportExpression(node) {
        checkSpecifier(node.source, staticSpecifier(node.source));
      },
      TSImportEqualsDeclaration(node) {
        const ref = node.moduleReference;
        if (ref?.type === 'TSExternalModuleReference') checkSpecifier(ref.expression, staticSpecifier(ref.expression));
      },
      TSImportType(node) {
        const literal = node.argument?.literal ?? node.argument;
        checkSpecifier(node, staticSpecifier(literal));
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          checkSpecifier(node, staticSpecifier(node.arguments[0]));
          return;
        }
        if (!inTest) return;
        // A test may read source files with node:fs. It may not read the fixtures or the demo state.
        const callee = node.callee;
        const name = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' ? memberKey(callee).value : undefined;
        const first = node.arguments[0];
        if (typeof name === 'string' && FS_READERS.test(name) && first && namesDataPath(first, sourceCode.getScope(node))) {
          context.report({ node, messageId: 'testRead', data: { name: sourceCode.getText(first) } });
        }
      },
      NewExpression(node) {
        if (!inTest && node.callee.type === 'Identifier' && node.callee.name === 'URL' && isImportMetaUrl(node.arguments[1])) {
          context.report({ node, messageId: 'newUrl' });
        }
      },
      // Every reference to a global that is not shadowed by a variable in the file. ESLint's scope analysis sees `const f = fetch`,
      // `Reflect.apply(fetch, ...)`, `globalThis['fetch']` and a destructured `{ fetch } = globalThis`, which a look at calls does not.
      'Program:exit'(program) {
        const globalScope = sourceCode.getScope(program);
        const referencesTo = (name) => {
          const found = [];
          const declared = globalScope.set.get(name); // configured or implicit lib globals
          if (declared && declared.defs.length === 0) found.push(...declared.references);
          for (const ref of globalScope.through) if (ref.identifier.name === name) found.push(ref);
          return found.filter((ref) => !isTypeOnlyReference(ref));
        };
        for (const ref of referencesTo('process')) checkProcess(ref.identifier);
        for (const ref of referencesTo('module')) checkModule(ref.identifier);
        for (const ref of referencesTo('require')) checkRequire(ref.identifier);
        for (const name of GLOBAL_OBJECTS) for (const ref of referencesTo(name)) checkGlobalObject(ref.identifier, name);
        if (inTest) return;
        for (const name of NETWORK_GLOBALS) {
          for (const ref of referencesTo(name)) {
            if (!isTypeOf(unwrap(ref.identifier))) context.report({ node: ref.identifier, messageId: 'network', data: { name } });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'opendispatch' },
  rules: {
    'no-physical-css': noPhysicalCss,
    'no-banned-import': noBannedImport,
  },
};

export default plugin;
