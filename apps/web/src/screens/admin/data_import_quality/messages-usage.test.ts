// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { messageLeaves } from '@/i18n/message-tree';
import { loadMessages } from '@/i18n/messages';

// A static scan: every message key the screen's source asks for exists in English and in Arabic, in the right
// namespace. next-intl only reports a missing key when the text is drawn, so a key on a path no test opens ships broken; this
// finds it from the source. `m(...)` is the module's namespace (`admin.data_import_quality`), `t(...)` and `tc(...)` are the core one.

const here = import.meta.dirname;
const files = fs.readdirSync(here).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && name !== 'types.ts');
const leaves = (locale: 'en' | 'ar') => messageLeaves(loadMessages(locale, 'admin.data_import_quality'));

interface Use {
  readonly file: string;
  readonly namespace: 'module' | 'core';
  readonly key: string;
  /** True when the key is built at run time (`kind.${x}`): only its static start is checked. */
  readonly dynamic: boolean;
}

function usesIn(file: string): Use[] {
  const text = fs.readFileSync(path.join(here, file), 'utf8');
  const uses: Use[] = [];
  // A translator is named m (module) or t / tc (core); `t = useTranslations('admin.data_import_quality')` in the Screen is `m` there too.
  for (const match of text.matchAll(/\b(m|t|tc)\(\s*(['"`])([^'"`]+)\2/g)) {
    const [, name, , raw] = match as unknown as [string, string, string, string];
    const dynamic = raw.includes('${');
    uses.push({ file, namespace: name === 'm' ? 'module' : 'core', key: dynamic ? raw.slice(0, raw.indexOf('${')) : raw, dynamic });
  }
  return uses;
}

const uses = files.flatMap(usesIn);

describe('message keys used by the Data Import and Quality screen', () => {
  it('finds the keys (the check is not vacuous)', () => {
    expect(uses.length).toBeGreaterThan(60);
    expect(uses.some((u) => u.dynamic)).toBe(true);
    expect(uses.some((u) => u.namespace === 'core')).toBe(true);
  });

  it.each(['en', 'ar'] as const)('all exist in %s', (locale) => {
    const all = leaves(locale);
    const missing = uses
      .filter((use) => {
        const full = use.namespace === 'module' ? `admin.data_import_quality.${use.key}` : use.key;
        return use.dynamic ? !Object.keys(all).some((key) => key.startsWith(full)) : all[full] === undefined;
      })
      .map((use) => `${use.file}: ${use.namespace === 'module' ? 'admin.data_import_quality.' : ''}${use.key}${use.dynamic ? '...' : ''}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('are asked for through the right translator: a `common.`, `roles.`, `scopes.`, `installModes.` or `demo.` key is core, never the module\'s', () => {
    const wrong = uses.filter((u) => u.namespace === 'module' && /^(common|roles|scopes|installModes|demo|patterns|shell|nav)\./.test(u.key));
    expect(wrong.map((u) => `${u.file}: ${u.key}`)).toEqual([]);
  });
});

describe('the module message files', () => {
  it('have the same keys in English and Arabic, no empty text, and Arabic in Arabic script', () => {
    const en = leaves('en');
    const ar = leaves('ar');
    const own = (tree: Record<string, string>) => Object.entries(tree).filter(([key]) => key.startsWith('admin.data_import_quality.'));
    expect(own(ar).map(([key]) => key).sort()).toEqual(own(en).map(([key]) => key).sort());
    for (const [key, text] of own(en)) expect(text.trim(), key).not.toBe('');
    for (const [key, text] of own(ar)) expect(/[؀-ۿ]/.test(text), `${key}: ${text}`).toBe(true);
  });

  it('give every ICU plural of the module its six Arabic categories', () => {
    const ar = leaves('ar');
    for (const [key, text] of Object.entries(ar)) {
      if (!key.startsWith('admin.data_import_quality.') || !text.includes(', plural,')) continue;
      for (const category of ['zero', 'one', 'two', 'few', 'many', 'other']) expect(text, key).toContain(`${category} {`);
    }
  });
});
