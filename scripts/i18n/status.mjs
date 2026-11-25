#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Review status of the Arabic messages: apps/web/messages/ar.status.json marks every Arabic key
// "draft" (not yet read by a native speaker) or "reviewed".
//
//   node scripts/i18n/status.mjs --sync     add new Arabic keys as draft, drop statuses of keys that are gone
//
// `pnpm exec tsx scripts/i18n/review-sheet.ts` lists the drafts for a reviewer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');

/** Every leaf of a tree as `dotted.path -> text`. */
export function leaves(tree, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(tree)) {
    const at = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out[at] = value;
    else Object.assign(out, leaves(value, at));
  }
  return out;
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** The message files: core, one folder per Admin and Ops module, and the status file. */
export function paths(root = ROOT) {
  const messages = path.join(root, 'apps/web/messages');
  return {
    messages,
    core: (locale) => path.join(messages, `${locale}.json`),
    // `core`, `admin.<module>` or `ops.<module>`
    scope: (scope, locale) => (scope === 'core' ? path.join(messages, `${locale}.json`) : path.join(messages, ...scope.split('.'), `${locale}.json`)),
    status: path.join(messages, 'ar.status.json'),
  };
}

/** Scopes tracked in ar.status.json: all of core, each Admin module and each Ops module. */
export function statusScopes(root = ROOT) {
  const p = paths(root);
  const scopes = {};
  scopes.core = leaves(readJson(p.core('ar'), {}));
  for (const area of ['admin', 'ops']) {
    const dir = path.join(p.messages, area);
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
      if (fs.statSync(path.join(dir, name)).isDirectory()) scopes[`${area}.${name}`] = leaves(readJson(p.scope(`${area}.${name}`, 'ar'), {}));
    }
  }
  return scopes;
}

export const STATUS_NOTE =
  'Review status of each Arabic key: "draft" (a first draft, not read by a native speaker) or "reviewed". `node scripts/i18n/status.mjs --sync` adds new keys as draft. `pnpm exec tsx scripts/i18n/review-sheet.ts` lists the drafts.';

/** Adds `draft` for every Arabic key without a status, drops statuses of keys that are gone. Returns what changed. */
export function syncStatus(root = ROOT, { write = true } = {}) {
  const p = paths(root);
  const status = readJson(p.status, {});
  const added = [];
  const removed = [];
  const next = { $note: STATUS_NOTE };
  for (const [scope, keys] of Object.entries(statusScopes(root))) {
    const before = status[scope] ?? {};
    const after = {};
    for (const key of Object.keys(keys).sort()) {
      after[key] = before[key] ?? 'draft';
      if (before[key] === undefined) added.push(`${scope}:${key}`);
    }
    for (const key of Object.keys(before)) if (after[key] === undefined) removed.push(`${scope}:${key}`);
    if (Object.keys(after).length > 0) next[scope] = after;
  }
  if (write) writeJson(p.status, next);
  return { added, removed };
}

function main(argv) {
  if (!argv.includes('--sync')) {
    console.error('Usage: node scripts/i18n/status.mjs --sync');
    return 2;
  }
  const result = syncStatus(ROOT, { write: true });
  console.log(`ar.status.json: ${result.added.length} added as draft, ${result.removed.length} removed`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
