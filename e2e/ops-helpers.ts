// SPDX-License-Identifier: AGPL-3.0-only
// Ops facts for ops-matrix, -states, -screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { OPS_MODULE_IDS, getModule, type ModuleDef } from '../apps/web/src/lib/access';
import { slugOf } from './admin-helpers';

const ROOT = path.resolve(import.meta.dirname, '..');

export const OPS_MODULES: readonly ModuleDef[] = OPS_MODULE_IDS.map((id) => getModule(id));

const screenSource = (def: ModuleDef): string => fs.readFileSync(path.join(ROOT, 'apps/web/src/screens/ops', def.id.slice('ops.'.length), 'Screen.tsx'), 'utf8');

// Does the ?state= branch pass an emptyAction?
export function hasStateEmptyAction(def: ModuleDef): boolean {
  const source = screenSource(def);
  const start = source.indexOf('if (state !== undefined)');
  if (start < 0) throw new Error(`${def.id}: Screen.tsx has no ?state= branch`);
  const end = source.indexOf('\n  }', start);
  return source.slice(start, end).includes('emptyAction=');
}

// docs/mockups/screens/ops-<slug>.html, if any.
export function opsMockup(def: ModuleDef): string | undefined {
  const file = path.join(ROOT, 'docs', 'mockups', 'screens', `ops-${slugOf(def)}.html`);
  return fs.existsSync(file) ? file : undefined;
}
