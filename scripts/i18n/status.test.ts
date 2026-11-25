// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, leaves, paths, statusScopes } from './status.mjs';

// The real message files: every Arabic key of a module, and of the shared blocks, has a review status, and no
// status is left for a key that is gone. Whoever adds Arabic keys runs
// `node scripts/i18n/status.mjs --sync` and this stays green.

const p = paths(ROOT);
const status = JSON.parse(fs.readFileSync(p.status, 'utf8')) as Record<string, Record<string, string> | string>;
const scopes = statusScopes(ROOT);

describe('messages/ar.status.json', () => {
  it('tracks all of core and every Admin and Ops module folder that has Arabic keys', () => {
    for (const [scope, keys] of Object.entries(scopes)) {
      if (Object.keys(keys).length === 0) continue;
      expect(status[scope], `${scope} has Arabic keys but no status`).toBeDefined();
    }
  });

  it.each(Object.keys(scopes).filter((scope) => Object.keys(scopes[scope] ?? {}).length > 0))('%s: every Arabic key has a status, draft or reviewed, and no status is stale', (scope) => {
    const tracked = (status[scope] ?? {}) as Record<string, string>;
    expect(Object.keys(tracked).sort()).toEqual(Object.keys(scopes[scope] ?? {}).sort());
    for (const value of Object.values(tracked)) expect(['draft', 'reviewed']).toContain(value);
  });

  it('has no status for a scope that does not exist', () => {
    for (const scope of Object.keys(status)) if (!scope.startsWith('$')) expect(scopes[scope], scope).toBeDefined();
  });

  it('is written in a stable order, so a review changes one line', () => {
    for (const [scope, keys] of Object.entries(status)) {
      if (scope.startsWith('$') || typeof keys === 'string') continue;
      expect(Object.keys(keys), scope).toEqual([...Object.keys(keys)].sort());
    }
  });
});

describe('the module message files', () => {
  it('have the same keys in English and Arabic (the pilot: users_roles)', () => {
    const en = Object.keys(leaves(JSON.parse(fs.readFileSync(p.scope('admin.users_roles', 'en'), 'utf8')))).sort();
    const ar = Object.keys(leaves(JSON.parse(fs.readFileSync(p.scope('admin.users_roles', 'ar'), 'utf8')))).sort();
    expect(ar).toEqual(en);
    expect(en.length).toBeGreaterThan(80);
  });

  it('keep every ICU placeholder of the English text in the Arabic text', () => {
    const en = leaves(JSON.parse(fs.readFileSync(p.scope('admin.users_roles', 'en'), 'utf8')));
    const ar = leaves(JSON.parse(fs.readFileSync(p.scope('admin.users_roles', 'ar'), 'utf8')));
    const names = (text: string) => [...new Set([...text.matchAll(/\{(\w+)/g)].map((m) => m[1]))].sort();
    for (const [key, text] of Object.entries(en)) expect(names(ar[key] ?? ''), key).toEqual(names(text));
  });

  it('the scripts folder has the status script, its types and the review sheet', () => {
    for (const file of ['status.mjs', 'status.d.mts', 'review-sheet.ts']) expect(fs.existsSync(path.join(ROOT, 'scripts/i18n', file)), file).toBe(true);
  });
});
