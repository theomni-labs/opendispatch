// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MODULE_IDS, OPS_MODULE_IDS } from '@/lib/access';
import { formatMessage } from './format-message';
import { fillCustomer, type Messages, mergeMessages, messageLeaves } from './message-tree';
import { ADMIN_MODULE_KEYS, adminModuleKey, coreMessages, loadMessages, loadServerMessages, moduleMessages, sliceOf } from './messages';

// The loader of the design: core everywhere, one module's messages on that module's route, nothing of another module.
// The message files start empty, so the isolation cases run on fake module tables (`sliceOf`) as well as the real files.

const fakeModules: Record<string, Messages> = {
  users_roles: { invite: 'Invite user', states: { empty: { desc: 'Invited users appear here.' } } },
  audit_log: { export: 'Export log' },
};

describe('mergeMessages and messageLeaves', () => {
  it('lays one tree over another level by level without changing either', () => {
    const base: Messages = { a: { x: '1', y: '2' }, b: 'B' };
    const extra: Messages = { a: { y: 'two', z: '3' }, c: { d: 'D' } };
    expect(mergeMessages(base, extra)).toEqual({ a: { x: '1', y: 'two', z: '3' }, b: 'B', c: { d: 'D' } });
    expect(base).toEqual({ a: { x: '1', y: '2' }, b: 'B' });
    expect(extra).toEqual({ a: { y: 'two', z: '3' }, c: { d: 'D' } });
  });

  it('lists leaves as dotted paths', () => {
    expect(messageLeaves({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' });
  });
});

describe('adminModuleKey', () => {
  it('is the module id without `admin.`, for the 17 Admin modules only', () => {
    expect(adminModuleKey('admin.users_roles')).toBe('users_roles');
    expect(ADMIN_MODULE_IDS.map(adminModuleKey)).toEqual([...ADMIN_MODULE_KEYS]);
    expect(adminModuleKey('ops.remote_queue')).toBeUndefined();
    expect(adminModuleKey('admin.nope')).toBeUndefined();
    expect(adminModuleKey('users_roles')).toBeUndefined();
    expect(adminModuleKey(undefined)).toBeUndefined();
  });
});

describe('sliceOf', () => {
  it('is the module’s messages at admin.<module>, and only that module', () => {
    const slice = sliceOf(fakeModules, 'admin.users_roles');
    expect(slice).toEqual({ admin: { users_roles: fakeModules['users_roles'] } });
    expect(Object.keys(messageLeaves(slice)).some((path) => path.includes('audit_log'))).toBe(false);
    expect(JSON.stringify(slice)).not.toContain('Export log');
  });

  it('is empty for an Ops module, an unknown module, and no module', () => {
    expect(sliceOf(fakeModules, 'ops.remote_queue')).toEqual({});
    expect(sliceOf(fakeModules, 'admin.nope')).toEqual({});
    expect(sliceOf(fakeModules, 'admin.constructor')).toEqual({});
    expect(sliceOf(fakeModules, undefined)).toEqual({});
  });
});

describe('loadMessages (what a page’s client gets)', () => {
  it.each(['en', 'ar'] as const)('gives core only on a page that is no module (%s)', (locale) => {
    const messages = loadMessages(locale);
    expect(messages).toEqual(coreMessages(locale));
    expect(Object.keys(messages)).not.toContain('admin');
    expect(messages['nav']).toBeDefined();
    expect(messages['ds']).toBeDefined();
  });

  it.each(['en', 'ar'] as const)('gives core plus that one module’s namespace on its route (%s)', (locale) => {
    const messages = loadMessages(locale, 'admin.audit_log');
    expect(messages['nav']).toBeDefined();
    expect(Object.keys(messages['admin'] as Messages)).toEqual(['audit_log']);
  });

  it('gives core only for an unknown module, an Ops module and a garbage id', () => {
    for (const id of ['admin.nope', 'ops.nope', 'nope', '', 'admin.', '__proto__']) {
      expect(loadMessages('en', id), id).toEqual(coreMessages('en'));
    }
  });

  it('never carries another module’s namespace, for any of the 17 modules', () => {
    for (const key of ADMIN_MODULE_KEYS) {
      const admin = loadMessages('en', `admin.${key}`)['admin'] as Messages;
      expect(Object.keys(admin), key).toEqual([key]);
    }
  });

  it('serves the default language for a locale it does not know', () => {
    expect(loadMessages('fr')).toEqual(coreMessages('en'));
  });

  it('is never smaller than core: a module adds keys and takes none away', () => {
    const core = Object.keys(messageLeaves(coreMessages('ar')));
    const withModule = new Set(Object.keys(messageLeaves(loadMessages('ar', 'admin.updates'))));
    for (const path of core) expect(withModule.has(path), path).toBe(true);
  });
});

describe('loadServerMessages (what the request config gives the server)', () => {
  it.each(['en', 'ar'] as const)('is core plus every one of the 17 modules (%s)', (locale) => {
    const messages = loadServerMessages(locale);
    expect(messages['nav']).toBeDefined();
    expect(Object.keys(messages['admin'] as Messages).sort()).toEqual([...ADMIN_MODULE_KEYS].sort());
  });

  it('has, for each module, what moduleMessages gives the client', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const id of ADMIN_MODULE_IDS) {
        const key = id.slice('admin.'.length);
        const server = (loadServerMessages(locale)['admin'] as Messages)[key];
        expect(server, `${locale} ${id}`).toEqual((moduleMessages(locale, id)['admin'] as Messages)[key]);
      }
    }
  });
});

describe('Ops modules', () => {
  // The build adds an Ops module's files as its screen is
  // built, so this reads folders on disk rather than
  // naming modules: whichever have a messages/ops/
  // <key> folder get core plus their own namespace,
  // the rest still get core only.
  const MESSAGES_DIR = path.join(import.meta.dirname, '../../messages');
  const opsDir = path.join(MESSAGES_DIR, 'ops');
  const builtOpsKeys = new Set(existsSync(opsDir) ? readdirSync(opsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []);

  it('a module with a messages/ops/<key> folder gets core plus its own namespace; every other module still gets core only', () => {
    for (const id of OPS_MODULE_IDS) {
      const key = id.slice('ops.'.length);
      const messages = loadMessages('en', id);
      if (builtOpsKeys.has(key)) expect(Object.keys(messages['ops'] as Messages), id).toEqual([key]);
      else expect(messages, id).toEqual(coreMessages('en'));
    }
  });

  it('the built Ops modules are not the empty set (the check above is not vacuous)', () => {
    expect(builtOpsKeys.size).toBeGreaterThan(0);
  });
});

// The loader holds every module's messages. If a client file imported it, they would all go to the browser.
describe('the loader stays on the server', () => {
  const SRC = path.join(import.meta.dirname, '..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) return sourceFiles(file);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
    });
  }

  it('is imported by no file that starts with "use client"', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      const isClient = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text);
      return isClient && /from\s+['"](?:@\/i18n\/messages|\.\/messages|\.\.\/i18n\/messages)['"]/.test(text);
    });
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });
});

describe('the customer name in the messages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const leaves = (locale: string) => Object.values(messageLeaves(loadServerMessages(locale)));
  const label = (locale: string) => ((loadServerMessages(locale)['dataSource'] as Messages)['IMPORTED'] as string);

  it('labels the imported sample the same in every install, and fills {customer} everywhere', () => {
    expect(label('en')).toBe('Imported sample');
    expect(label('ar')).toBe('عيّنة مستوردة');
    expect(leaves('en').some((text) => text.includes('{customer}'))).toBe(false);
  });

  it('uses the configured name when set, with no placeholder left in any message', () => {
    vi.stubEnv('OPENDISPATCH_CUSTOMER_SHORT_NAME', 'Operator');
    vi.stubEnv('OPENDISPATCH_CUSTOMER_SHORT_NAME_AR', 'المشغّل');
    expect(label('en')).toBe('Imported sample');
    expect(label('ar')).toBe('عيّنة مستوردة');
    expect(leaves('en').filter((text) => text.includes('{customer}'))).toEqual([]);
    expect(leaves('ar').filter((text) => text.includes('{customer}'))).toEqual([]);
    expect(JSON.stringify(coreMessages('ar'))).toContain('المشغّل');
    expect(JSON.stringify(moduleMessages('en', 'ops.field_planner'))).toContain('Nothing was sent to the Operator systems');
  });

  it('keeps ICU characters in a name literal', () => {
    const tree = fillCustomer({ m: "{n, plural, one {# by {customer}} other {# by {customer}'s team}}" }, "A{b}'c");
    expect(formatMessage('en', tree['m'] as string, { n: 2 })).toBe("2 by A{b}'c's team");
  });
});
