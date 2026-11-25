// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { type Translate, stateText } from './screen-text';

// A translate function over a flat table, with the `has` next-intl gives it.
function translator(table: Record<string, string>): Translate {
  const t = ((key: string) => table[key] ?? `[missing ${key}]`) as Translate;
  t.has = (key) => key in table;
  return t;
}

const core = { 'states.empty.title': 'Nothing here yet', 'states.error.title': 'Something went wrong', 'states.error.desc': 'The data could not load.' };

describe('stateText', () => {
  it('uses the module’s own line when its message file has one', () => {
    const t = translator({ ...core, 'admin.users_roles.states.error.desc': 'Users could not load.', 'admin.users_roles.states.empty.desc': 'Invited users appear here.' });
    expect(stateText(t, 'admin.users_roles', 'error', 'desc')).toBe('Users could not load.');
    expect(stateText(t, 'admin.users_roles', 'empty', 'desc')).toBe('Invited users appear here.');
  });

  it('falls back to the core line for a part the module does not write', () => {
    const t = translator({ ...core, 'admin.users_roles.states.error.desc': 'Users could not load.' });
    expect(stateText(t, 'admin.users_roles', 'error', 'title')).toBe('Something went wrong');
    expect(stateText(t, 'admin.users_roles', 'empty', 'title')).toBe('Nothing here yet');
  });

  it('does not take another module’s line', () => {
    const t = translator({ ...core, 'admin.audit_log.states.error.desc': 'The audit log could not load.' });
    expect(stateText(t, 'admin.users_roles', 'error', 'desc')).toBe('The data could not load.');
  });

  it('has no description for an empty state when neither the module nor the core writes one', () => {
    expect(stateText(translator(core), 'admin.users_roles', 'empty', 'desc')).toBeUndefined();
  });

  it('uses the core line with no module (a page that is not a module page)', () => {
    expect(stateText(translator(core), undefined, 'error', 'desc')).toBe('The data could not load.');
  });
});
