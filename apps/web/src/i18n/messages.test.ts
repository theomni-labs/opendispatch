// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_MODULE_IDS, GROUPS, MODULES } from '@/lib/access';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { messageLeaves } from './message-tree';
import { ADMIN_MODULE_KEYS, moduleMessages } from './messages';

type Tree = { [key: string]: string | Tree };

// Every leaf path in a message tree, for example 'nav.ops.forecast_explorer.title'.
function leaves(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, leaves(value, path));
  }
  return out;
}

const EN = leaves(en as Tree);
const AR = leaves(ar as Tree);

// Words that stay Latin in Arabic on purpose: the product name and the English language name. The `ds.*` entries are
// design system labels that are only placeholders, a dash or punctuation in every language, so they hold no Arabic
// letter.
const LATIN_ALLOWED = new Set([
  'shell.brand',
  'opendispatch.dispatch.source.opendispatch', // the product name, as an assignment source label
  'opendispatch.dispatch.source.customer', // {customer}, filled by the loader
  'language.en',
  'ds.pagination.compact', // "{page} / {pages}"
  'ds.descriptionList.empty', // an em dash for an empty value
  'ds.chart.titled', // "{title}. {summary}"
  'ds.donutChart.item', // "{label} {value} ({percent})"
]);
const wordCount = (text: string) => text.trim().split(/\s+/).length;

describe('messages', () => {
  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('has no empty strings', () => {
    for (const [path, text] of [...Object.entries(EN), ...Object.entries(AR)]) expect(text.trim(), path).not.toBe('');
  });

  it('has a title and a menu label for all 30 modules, and a label for all 7 groups', () => {
    expect(MODULES).toHaveLength(30);
    for (const m of MODULES) {
      const [console, name] = m.id.split('.') as [string, string];
      expect(EN[`nav.${console}.${name}.title`], m.titleKey).toBeDefined();
      expect(EN[`nav.${console}.${name}.menu`], m.menuKey).toBeDefined();
      expect(AR[`nav.${console}.${name}.title`], m.titleKey).toBeDefined();
      expect(AR[`nav.${console}.${name}.menu`], m.menuKey).toBeDefined();
    }
    expect(GROUPS).toHaveLength(7);
    for (const g of GROUPS) {
      expect(EN[g.groupKey], g.groupKey).toBeDefined();
      expect(AR[g.groupKey], g.groupKey).toBeDefined();
    }
  });

  it('keeps the module title for the English page title and 1 to 3 words for every menu label', () => {
    for (const m of MODULES) {
      const [console, name] = m.id.split('.') as [string, string];
      expect(EN[`nav.${console}.${name}.title`]).toBe(m.titleEn);
      expect(wordCount(EN[`nav.${console}.${name}.menu`] ?? ''), `${m.id} (en)`).toBeLessThanOrEqual(3);
      expect(wordCount(AR[`nav.${console}.${name}.menu`] ?? ''), `${m.id} (ar)`).toBeLessThanOrEqual(3);
    }
  });

  it('writes Arabic in Arabic script, with no English left over', () => {
    for (const [path, text] of Object.entries(AR)) {
      if (LATIN_ALLOWED.has(path)) continue;
      expect(/[؀-ۿ]/.test(text), `${path}: "${text}"`).toBe(true);
    }
  });

  it('has a role name, a scope and an install mode label in both languages', () => {
    for (const key of ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver']) {
      expect(EN[`roles.${key}`]).toBeDefined();
      expect(AR[`roles.${key}`]).toBeDefined();
    }
    for (const key of ['whole_install', 'assigned_zones', 'remote_pool']) expect(AR[`scopes.${key}`]).toBeDefined();
    for (const key of ['private', 'dedicated', 'shared']) expect(AR[`installModes.${key}`]).toBeDefined();
  });
});

// Per-module message files. They start empty and each
// module agent fills its own; these tests hold for whatever they hold, so they need no change when a file grows.
const MESSAGES_DIR = path.join(import.meta.dirname, '../../messages');
const MODULE_KEYS = ADMIN_MODULE_IDS.map((id) => id.slice('admin.'.length));
// Latin text a module's Arabic may keep on purpose (a code, a product or protocol name), by full path. Add a path here
// only with the reason next to it; the core list above is the model.
const MODULE_LATIN_ALLOWED = new Set<string>([]);

describe('module message files', () => {
  it('has one folder per Admin module, named by its id without the console, and no other folder', () => {
    const folders = readdirSync(path.join(MESSAGES_DIR, 'admin'), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(folders.map((f) => f.name).sort()).toEqual([...MODULE_KEYS].sort());
    expect(ADMIN_MODULE_KEYS).toEqual(MODULE_KEYS);
    expect(MODULE_KEYS).toHaveLength(18);
  });

  it('has exactly an English and an Arabic file in each folder', () => {
    for (const key of MODULE_KEYS) {
      const files = readdirSync(path.join(MESSAGES_DIR, 'admin', key)).sort();
      expect(files, key).toEqual(['ar.json', 'en.json']);
    }
  });

  it('has the same keys in English and Arabic, in every module', () => {
    for (const key of MODULE_KEYS) {
      const id = `admin.${key}`;
      const en = Object.keys(messageLeaves(moduleMessages('en', id))).sort();
      const ar = Object.keys(messageLeaves(moduleMessages('ar', id))).sort();
      expect(ar, id).toEqual(en);
    }
  });

  it('has no empty string, and writes Arabic in Arabic script, in every module', () => {
    for (const key of MODULE_KEYS) {
      const id = `admin.${key}`;
      for (const [leaf, text] of Object.entries(messageLeaves(moduleMessages('en', id)))) expect(text.trim(), `en ${leaf}`).not.toBe('');
      for (const [leaf, text] of Object.entries(messageLeaves(moduleMessages('ar', id)))) {
        expect(text.trim(), `ar ${leaf}`).not.toBe('');
        if (!MODULE_LATIN_ALLOWED.has(leaf)) expect(/[؀-ۿ]/.test(text), `${leaf}: "${text}"`).toBe(true);
      }
    }
  });

  it('keeps `admin` for module files: the core files have no top-level admin namespace', () => {
    expect(Object.keys(en)).not.toContain('admin');
    expect(Object.keys(ar)).not.toContain('admin');
  });

  it('gives the module title, in both languages, for each Admin module (the module files add to these, never replace them)', () => {
    for (const id of ADMIN_MODULE_IDS) {
      expect(EN[`nav.${id}.title`], id).toBeDefined();
      expect(AR[`nav.${id}.title`], id).toBeDefined();
    }
  });
});
