// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LABELS, type LabelParams, resolveLabel } from '@opendispatch/ui';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { buildDsLabels, DS_LABEL_KEYS } from './ds-labels';

// The design system's built-in strings live in messages/*.json under `ds`. These tests fail when the
// design system adds, renames or removes a label, or when a message uses a placeholder the design system never
// passes. The Arabic is a draft pending native review; these tests check its form, not its wording.

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, leaves(value, path));
  }
  return out;
}

const EN_DS = leaves((en as Tree)['ds'] as Tree);
const AR_DS = leaves((ar as Tree)['ds'] as Tree);
const DS_KEYS = Object.keys(DEFAULT_LABELS);

// The parameters the design system's components pass to each label that is a function there (read from the
// call sites in packages/ui/src). A string label's parameters are its {placeholders}.
const FUNCTION_LABEL_PARAMS: Record<string, readonly string[]> = {
  'lineChart.summary': ['series', 'count', 'first', 'last', 'min', 'max'],
  'barChart.summary': ['stacked', 'horizontal', 'categories', 'seriesCount', 'names', 'min', 'max'],
  'sparkline.summary': ['count', 'min', 'max', 'latest'],
  'heatGrid.summary': ['rows', 'columns', 'min', 'max'],
  'railShell.notificationsUnread': ['count'],
  'commandPalette.count': ['count'],
};

// Parameters that carry a number: a count (plural rules apply) or a flag written as 0 or 1.
const COUNT_PARAMS = new Set(['n', 'count', 'rows', 'columns', 'categories', 'seriesCount']);
const FLAG_PARAMS = new Set(['stacked', 'horizontal']);
const COUNTS = [0, 1, 2, 3, 10, 11, 99, 100, 102] as const;
const ARABIC_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

// A small reader for the ICU subset the messages use: {name} and {name, plural, selector {text} ...}, nested.
interface PluralBlock {
  name: string;
  selectors: string[];
}

function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced braces in: ${text}`);
}

function readMessage(message: string): { names: Set<string>; plurals: PluralBlock[] } {
  const names = new Set<string>();
  const plurals: PluralBlock[] = [];
  const walk = (text: string): void => {
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '{') {
        i += 1;
        continue;
      }
      const end = closingBrace(text, i);
      const inner = text.slice(i + 1, end);
      const comma = inner.indexOf(',');
      if (comma === -1) {
        names.add(inner.trim());
      } else {
        const name = inner.slice(0, comma).trim();
        names.add(name);
        const afterName = inner.slice(comma + 1);
        const secondComma = afterName.indexOf(',');
        expect(afterName.slice(0, secondComma).trim(), `only plural is used: ${message}`).toBe('plural');
        const block: PluralBlock = { name, selectors: [] };
        let rest = afterName.slice(secondComma + 1);
        for (;;) {
          rest = rest.trimStart();
          if (rest === '') break;
          const open = rest.indexOf('{');
          block.selectors.push(rest.slice(0, open).trim());
          const close = closingBrace(rest, open);
          walk(rest.slice(open + 1, close));
          rest = rest.slice(close + 1);
        }
        plurals.push(block);
      }
      i = end + 1;
    }
  };
  walk(message);
  return { names, plurals };
}

// What a key may use: its {placeholders} for a string label, the listed parameters for a function label.
function expectedParams(key: string): string[] {
  const value = DEFAULT_LABELS[key];
  if (typeof value === 'function') {
    const listed = FUNCTION_LABEL_PARAMS[key];
    if (listed === undefined) throw new Error(`"${key}" is a function label in the design system: list its parameters in FUNCTION_LABEL_PARAMS`);
    return [...listed];
  }
  return [...new Set([...(value ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))];
}

// Sample parameters: every count-like parameter takes each count, flags take 0 and 1, the rest is text.
function samples(key: string, text: string): LabelParams[] {
  const names = expectedParams(key);
  const counted = COUNTS.flatMap((c) => [0, 1].map((flag) => ({ c, flag })));
  return counted.map(({ c, flag }) =>
    Object.fromEntries(
      names.map((name) => [name, COUNT_PARAMS.has(name) ? c : FLAG_PARAMS.has(name) ? flag : `${text}${name.length}`]),
    ),
  );
}

// next-intl derives the allowed values from the message text, which a JSON import does not carry as a literal type;
// this file checks the messages at run time, so it asks with plain strings and numbers.
type Translate = (key: string, values?: LabelParams) => string;

const translate = (locale: 'en' | 'ar'): Translate =>
  createTranslator({
    locale,
    messages: (locale === 'ar' ? ar : en) as Tree,
    namespace: 'ds',
    onError: (error) => {
      throw error; // a missing or malformed message must fail the test, not log and fall back to the key
    },
  }) as Translate;

describe('design system labels in the message files', () => {
  it('lists every design system label key (a new, renamed or removed key fails here)', () => {
    expect([...DS_LABEL_KEYS].sort()).toEqual([...DS_KEYS].sort());
  });

  it('has a message for every design system label, in English and in Arabic', () => {
    for (const key of DS_KEYS) {
      expect(EN_DS[key], `en ds.${key}`).toBeTypeOf('string');
      expect(AR_DS[key], `ar ds.${key}`).toBeTypeOf('string');
    }
  });

  it('has the same keys under ds in both languages, and none the design system does not know', () => {
    expect(Object.keys(AR_DS).sort()).toEqual(Object.keys(EN_DS).sort());
    expect(Object.keys(EN_DS).sort()).toEqual([...DS_KEYS].sort());
  });

  it('uses only the placeholders the design system passes, and all of them', () => {
    for (const key of DS_KEYS) {
      const wanted = expectedParams(key).sort();
      for (const [language, messages] of [['en', EN_DS], ['ar', AR_DS]] as const) {
        const used = [...readMessage(messages[key] ?? '').names].sort();
        expect(used, `${language} ds.${key}`).toEqual(wanted);
      }
    }
  });

  it('has no apostrophe or "#" in a message (ICU escape and locale-formatted count)', () => {
    for (const [path, text] of [...Object.entries(EN_DS), ...Object.entries(AR_DS)]) {
      expect(text, path).not.toMatch(/['#]/);
    }
  });
});

describe('English messages', () => {
  it('give exactly the design system default text, for every key and every sample count', () => {
    const t = translate('en');
    for (const key of DS_KEYS) {
      for (const params of samples(key, 'Sample')) {
        expect(t(key, params), `${key} ${JSON.stringify(params)}`).toBe(resolveLabel({}, key, params));
      }
    }
  });
});

describe('Arabic messages (a draft pending native review)', () => {
  it('resolve without throwing for every key and every sample count, with nothing left unresolved', () => {
    const t = translate('ar');
    for (const key of DS_KEYS) {
      for (const params of samples(key, 'س')) {
        const text = t(key, params);
        expect(text.trim(), `${key} ${JSON.stringify(params)}`).not.toBe('');
        expect(text, key).not.toMatch(/[{}]/);
      }
    }
  });

  it('contain no Latin letter once the placeholders are filled (units are written in Arabic)', () => {
    const t = translate('ar');
    for (const key of DS_KEYS) {
      for (const params of samples(key, 'س')) expect(t(key, params), key).not.toMatch(/[A-Za-z]/);
    }
  });

  it('give every count its own text: zero, one and two are written out, 3 to 10 and 11 to 99 differ', () => {
    const t = translate('ar');
    const isCounted = (key: string): boolean =>
      readMessage(AR_DS[key] ?? '').plurals.some((block) => !FLAG_PARAMS.has(block.name));
    const countKeys = DS_KEYS.filter(isCounted);
    // Every label that speaks of a number of things. `chart.compact*` take an already formatted number ("12.6"),
    // not a count, so they are not plurals.
    expect(countKeys.sort()).toEqual(
      [
        'avatar.more',
        'barChart.summary',
        'commandPalette.count',
        'dataTable.selectedCount',
        'heatGrid.summary',
        'lineChart.summary',
        'railShell.notificationsUnread',
        'sparkline.summary',
      ].sort(),
    );
    for (const key of countKeys) {
      const at = (count: number): string =>
        t(key, Object.fromEntries(expectedParams(key).map((name) => [name, COUNT_PARAMS.has(name) ? count : FLAG_PARAMS.has(name) ? 1 : 'س'])));
      const forms = new Set([at(0), at(1), at(2), at(3), at(11), at(100)].map((text) => text.replace(/\d+/g, '#')));
      // zero, one, two, few (3 to 10) and many (11 to 99) read differently; other (100) may equal many.
      expect(forms.size, key).toBeGreaterThanOrEqual(5);
    }
  });

  it('write every plural with all six Arabic categories (a 0 or 1 flag with =1 and other is not a plural)', () => {
    for (const key of DS_KEYS) {
      for (const block of readMessage(AR_DS[key] ?? '').plurals) {
        const isFlag = FLAG_PARAMS.has(block.name);
        if (isFlag) {
          expect(block.selectors.sort(), `${key} ${block.name}`).toEqual(['=1', 'other']);
        } else {
          expect(block.selectors.sort(), `${key} ${block.name}`).toEqual([...ARABIC_CATEGORIES].sort());
        }
      }
    }
  });
});

describe('buildDsLabels', () => {
  it('returns a function for every design system key, and each one asks next-intl for that key', () => {
    const calls: Array<[string, LabelParams | undefined]> = [];
    const labels = buildDsLabels((key, values) => {
      calls.push([key, values]);
      return `<${key}>`;
    });
    expect(Object.keys(labels).sort()).toEqual([...DS_KEYS].sort());
    for (const key of DS_KEYS) {
      const label = labels[key];
      expect(typeof label, key).toBe('function');
      if (typeof label === 'function') expect(label({ n: 2 })).toBe(`<${key}>`);
    }
    expect(calls).toHaveLength(DS_KEYS.length);
    expect(calls[0]).toEqual([DS_KEYS[0], { n: 2 }]);
  });

  it('is what Providers.tsx hands to the design system, together with the router link, navigation and path', () => {
    const source = readFileSync(fileURLToPath(new URL('../components/opendispatch/Providers.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("useTranslations('ds')");
    expect(source).toContain('buildDsLabels(t)');
    expect(source).toContain('labels={labels}');
    expect(source).toContain('linkComponent={Link}');
    expect(source).toContain('activePath={pathname}');
    expect(source).toMatch(/navigate=\{navigate\}/);
    expect(source).toContain("from '@/i18n/navigation'");
  });
});
