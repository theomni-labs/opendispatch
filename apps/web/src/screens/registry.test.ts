// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_MODULE_IDS, OPS_MODULE_IDS } from '@/lib/access';
import { ADMIN_SCREEN_LOADERS, loadAdminScreen } from './registry';

// The registry of Admin screens. It never changes when a screen is added: each module's own index.ts does.
const ADMIN_DIR = path.join(import.meta.dirname, 'admin');
const KEYS = ADMIN_MODULE_IDS.map((id) => id.slice('admin.'.length));

describe('screen registry', () => {
  it('has one loader for each of the 18 Admin modules, and no other', () => {
    expect(Object.keys(ADMIN_SCREEN_LOADERS).sort()).toEqual([...ADMIN_MODULE_IDS].sort());
    expect(Object.keys(ADMIN_SCREEN_LOADERS)).toHaveLength(18);
  });

  it('has one folder per module under screens/admin, named as its message folder, and no other folder', () => {
    const folders = readdirSync(ADMIN_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(folders.map((f) => f.name).sort()).toEqual([...KEYS].sort());
    const messageFolders = readdirSync(path.join(import.meta.dirname, '../../messages/admin')).sort();
    expect(messageFolders).toEqual([...KEYS].sort());
  });

  it('has an index.ts in each folder that exports `screen`, the only thing the registry reads', () => {
    for (const key of KEYS) {
      const source = readFileSync(path.join(ADMIN_DIR, key, 'index.ts'), 'utf8');
      expect(source, key).toMatch(/export const screen\b/);
      expect(source, key).toContain("from '@/screens/types'");
    }
  });

  it('points each loader at its own module’s folder', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'registry.ts'), 'utf8');
    for (const id of ADMIN_MODULE_IDS) expect(source, id).toContain(`'${id}': () => import('./admin/${id.slice('admin.'.length)}')`);
  });

  it('gives the screen of a module that has one, or nothing so the placeholder page shows', async () => {
    for (const id of ADMIN_MODULE_IDS) {
      const screen = await loadAdminScreen(id);
      expect(screen === undefined || typeof screen === 'function', id).toBe(true);
    }
  });

  it('gives nothing for an Ops module, an unknown id and an id that is only a property name of every object', async () => {
    for (const id of [...OPS_MODULE_IDS, 'admin.nope', 'nope', '', 'constructor', '__proto__', 'toString']) {
      expect(await loadAdminScreen(id), id).toBeUndefined();
    }
  });
});
