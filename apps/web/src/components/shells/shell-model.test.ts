// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { CONSOLES, INSTALL_MODES, canSeeConsole, menuFor, moduleAccess, rolesForInstallMode, type ModuleId } from '@/lib/access';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { shellConsoles, shellSearchItems, type Translate } from './shell-model';

type Tree = { [key: string]: string | Tree };

function translator(messages: Tree): Translate {
  return (key) => {
    let node: string | Tree | undefined = messages;
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    if (typeof node !== 'string') throw new Error(`No message ${key}`);
    return node;
  };
}

const tEn = translator(en as Tree);
const tAr = translator(ar as Tree);

// The same guarantee the e2e specs make in the browser: the rail is the access model's menu, for every role and mode.
const CASES = INSTALL_MODES.flatMap((mode) => rolesForInstallMode(mode).map((role) => ({ mode, role })));

describe('shellConsoles', () => {
  it.each(CASES)('is menuFor for $role in a $mode install, in both languages', ({ mode, role }) => {
    for (const t of [tEn, tAr]) {
      const consoles = shellConsoles(role, mode, t);
      const menu = menuFor(role, mode);
      expect(consoles.map((c) => c.id)).toEqual(menu.map((c) => c.console));
      consoles.forEach((entry, index) => {
        const expected = menu[index];
        expect(entry.label).toBe(t(`shell.console.${entry.id}`));
        expect(entry.sections.map((s) => s.id)).toEqual(expected?.groups.map((g) => g.group));
        expect(entry.sections.map((s) => s.items.map((i) => i.id))).toEqual(expected?.groups.map((g) => g.items.map((m) => m.id)));
        for (const section of entry.sections) {
          for (const item of section.items) {
            expect(item.href.startsWith(`/${entry.id}/`), item.href).toBe(true);
            expect(item.viewOnly, `${role} ${item.id}`).toBe(moduleAccess(role, item.id as ModuleId, mode).access === 'view');
          }
        }
      });
    }
  });

  it('gives a console switch (two consoles) only to roles that see both, and nothing to a role with no console', () => {
    for (const { mode, role } of CASES) {
      const seen = CONSOLES.filter((c) => canSeeConsole(role, c, mode));
      expect(shellConsoles(role, mode, tEn).map((c) => c.id), `${role} ${mode}`).toEqual(seen);
    }
    // Change Approver has no console outside a private install, so it is not offered there at all.
    expect(shellConsoles('change_approver', 'private', tEn).map((c) => c.id)).toEqual(['admin']);
    expect(shellConsoles('dispatcher', 'private', tEn).map((c) => c.id)).toEqual(['ops']);
    expect(shellConsoles('administrator', 'private', tEn).map((c) => c.id)).toEqual(['ops', 'admin']);
  });

  it('marks the Administrator’s Ops modules view only and its Admin modules editable', () => {
    const [ops, admin] = shellConsoles('administrator', 'private', tEn);
    expect(ops?.sections.flatMap((s) => s.items).every((i) => i.viewOnly)).toBe(true);
    expect(admin?.sections.flatMap((s) => s.items).some((i) => !i.viewOnly)).toBe(true);
  });
});

describe('shellSearchItems', () => {
  it.each(CASES)('lists exactly the modules of $role in a $mode install', ({ mode, role }) => {
    const ids = menuFor(role, mode).flatMap((c) => c.groups.flatMap((g) => g.items.map((m) => m.id)));
    expect(shellSearchItems(role, mode, tEn, [tAr]).map((i) => i.id)).toEqual(ids);
  });

  it('labels by title, names the console, and matches the other language and the menu label as keywords', () => {
    const items = shellSearchItems('administrator', 'private', tEn, [tAr]);
    const audit = items.find((i) => i.id === 'admin.audit_log');
    expect(audit).toMatchObject({ label: 'Audit Log', meta: 'Admin Console', href: '/admin/audit-log' });
    expect(audit?.keywords).toContain('سجل التدقيق');

    // The same in Arabic: the English title is found by an Arabic reader.
    const inArabic = shellSearchItems('administrator', 'private', tAr, [tEn]).find((i) => i.id === 'ops.remote_queue');
    expect(inArabic?.label).toBe('طابور العمل عن بُعد والجدولة');
    expect(inArabic?.keywords).toContain('Remote Queue and Scheduling');
    expect(inArabic?.keywords).toContain('Remote Queue');
  });
});
