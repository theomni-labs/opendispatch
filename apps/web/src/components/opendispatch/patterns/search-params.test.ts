// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { param, parseSearchParams } from './search-params';

const ROLES = ['administrator', 'planner'] as const;
const UUID = '6f52eded-7db7-4d9e-a601-2be325208161';
const SCHEMA = {
  tab: param.enum(['users', 'roles']),
  q: param.text(10),
  role: param.enum(ROLES),
  page: param.int(1, 50),
  id: param.id(),
  new: param.flag(),
  sort: param.sort(['name', 'role']),
  rule: param.pattern(/^RULE-\d{3}[A-Z]?$/, 12),
};

describe('parseSearchParams', () => {
  it('reads every kind of parameter when the value is valid', () => {
    expect(parseSearchParams({ tab: 'roles', q: '  nour ', role: 'planner', page: '2', id: UUID, new: '1', sort: 'role:desc', rule: 'RULE-012A' }, SCHEMA)).toEqual({
      tab: 'roles',
      q: 'nour',
      role: 'planner',
      page: 2,
      id: UUID,
      new: true,
      sort: { key: 'role', direction: 'desc' },
      rule: 'RULE-012A',
    });
  });

  it('gives nothing for a value that is not on its allow-list', () => {
    expect(parseSearchParams({ tab: 'settings', role: 'root', page: '0', id: 'not-a-uuid', new: 'yes', sort: 'salary:asc', rule: 'rm -rf' }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ page: '51' }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ page: '-1' }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ page: '1.5' }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ page: '1e3' }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ page: '0x10' }, SCHEMA)).toEqual({});
  });

  it('ignores parameters the schema does not declare, so a role or customer in the URL changes nothing', () => {
    const parsed = parseSearchParams({ tab: 'users', customer: 'other', tenant_id: 'x', installMode: 'shared', userId: UUID, ctx: '{}', __proto__: 'x' }, SCHEMA);
    expect(parsed).toEqual({ tab: 'users' });
  });

  it('takes the first of a repeated parameter', () => {
    expect(parseSearchParams({ tab: ['roles', 'users'] }, SCHEMA)).toEqual({ tab: 'roles' });
    expect(parseSearchParams({ tab: [] }, SCHEMA)).toEqual({});
  });

  it('leaves absent parameters out (the result has only the keys that passed)', () => {
    expect(Object.keys(parseSearchParams({}, SCHEMA))).toEqual([]);
    expect(Object.keys(parseSearchParams({ tab: undefined }, SCHEMA))).toEqual([]);
  });

  it('strips control characters from search text, trims it, cuts it to the limit and treats empty as absent', () => {
    expect(parseSearchParams({ q: 'a\u0000b\nc\u007fd' }, SCHEMA)).toEqual({ q: 'abcd' });
    expect(parseSearchParams({ q: '0123456789ABCDEF' }, SCHEMA)).toEqual({ q: '0123456789' });
    expect(parseSearchParams({ q: '   ' }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ q: '\u0000\u0001' }, SCHEMA)).toEqual({});
  });

  it('does not read a value from the prototype chain', () => {
    const schema = { constructor: param.text(20), toString: param.text(20) };
    expect(parseSearchParams({}, schema)).toEqual({});
    expect(parseSearchParams(Object.create({ constructor: 'inherited' }) as Record<string, string>, schema)).toEqual({});
  });

  it('refuses a sort with a wrong shape', () => {
    for (const bad of ['name', 'name:', ':asc', 'name:asc:extra', 'name:ASC', 'name:up']) expect(parseSearchParams({ sort: bad }, SCHEMA)).toEqual({});
  });

  it('accepts UUIDs in either case and refuses look-alikes', () => {
    expect(parseSearchParams({ id: UUID.toUpperCase() }, SCHEMA)).toEqual({ id: UUID.toUpperCase() });
    expect(parseSearchParams({ id: `${UUID}x` }, SCHEMA)).toEqual({});
    expect(parseSearchParams({ id: `../${UUID}` }, SCHEMA)).toEqual({});
  });

  it('caps a pattern value at its length', () => {
    expect(parseSearchParams({ rule: 'RULE-012AAAAAAAAAAAAA' }, SCHEMA)).toEqual({});
  });
});

describe('a schema may not let the address bar say who is asking', () => {
  it.each(['customer', 'customerId', 'customer_id', 'tenant', 'tenant-id', 'installMode', 'install_mode', 'ctx', 'context', 'userId', 'user', 'zoneScope'])('refuses a parameter called %s', (name) => {
    expect(() => parseSearchParams({}, { [name]: param.text() })).toThrow(/never says who is asking/);
  });

  it('allows a list filter called role: it is checked against the enum and is not the caller\'s role', () => {
    expect(parseSearchParams({ role: 'administrator' }, { role: param.enum(ROLES) })).toEqual({ role: 'administrator' });
    expect(parseSearchParams({ role: 'dispatcher' }, { role: param.enum(ROLES) })).toEqual({});
  });
});
