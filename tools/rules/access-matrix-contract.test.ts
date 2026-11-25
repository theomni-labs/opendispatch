// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { getBundledOpenapi } from '../../scripts/contracts/schemas';
import { ROLES, MODULE_IDS, moduleAccess, approvalKindsFor, APPROVAL_MODULE } from '../../apps/web/src/lib/access';

// Review finding: the access matrix exists twice, in apps/web/src/lib/access/matrix.ts and as `x-modules`
// in contracts/openapi.yaml. The two must never drift. Module ids differ in spelling, so modules are matched by
// console and number. The contract lists the private install, where every role exists.

interface ContractModule {
  readonly id: string;
  readonly console: 'ops' | 'admin' | 'platform';
  readonly number: number;
  readonly access: Readonly<Record<string, string>>;
  readonly approvers: readonly string[];
}

const contract = getBundledOpenapi() as unknown as { 'x-modules': ContractModule[] };
// `platform.*` entries are shared areas (sessions, demo), not console modules.
const modules = contract['x-modules'].filter((m) => m.console !== 'platform');

const codeModuleFor = (m: ContractModule): (typeof MODULE_IDS)[number] => {
  const id = MODULE_IDS.filter((x) => x.startsWith(`${m.console}.`))[m.number - 1];
  if (id === undefined) throw new Error(`No module ${m.console} ${m.number} in the code`);
  return id;
};

describe('access matrix: code equals contract', () => {
  it('lists the same 30 modules', () => {
    expect(modules).toHaveLength(MODULE_IDS.length);
    expect(new Set(modules.map(codeModuleFor)).size).toBe(MODULE_IDS.length);
  });

  it('lists the same roles for every module', () => {
    for (const m of modules) expect(Object.keys(m.access).sort(), m.id).toEqual([...ROLES].sort());
  });

  it('gives every role the same access to every module in the private install', () => {
    const differences: string[] = [];
    for (const m of modules) {
      for (const role of ROLES) {
        const code = moduleAccess(role, codeModuleFor(m), 'private').access;
        if (code !== m.access[role]) differences.push(`${m.id} ${role}: contract ${String(m.access[role])}, code ${code}`);
      }
    }
    expect(differences).toEqual([]);
  });

  it('names the same approvers for every module', () => {
    const differences: string[] = [];
    for (const m of modules) {
      const moduleId = codeModuleFor(m);
      const code = ROLES.filter((role) => approvalKindsFor(role, 'private').some((kind) => APPROVAL_MODULE[kind] === moduleId)).sort();
      const listed = [...m.approvers].sort();
      if (JSON.stringify(code) !== JSON.stringify(listed)) differences.push(`${m.id}: contract [${listed.join(', ')}], code [${code.join(', ')}]`);
    }
    expect(differences).toEqual([]);
  });
});
