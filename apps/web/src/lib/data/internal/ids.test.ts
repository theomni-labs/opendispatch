// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DataError, InvalidInputError } from '../errors';
import { isId, requireId } from './ids';

const UUID = '3fa89d67-3189-4d62-bed3-2916a8c19b72';

describe('requireId (review finding M4)', () => {
  it('returns a UUID string unchanged, in either case', () => {
    expect(requireId(UUID, 'City')).toBe(UUID);
    expect(requireId(UUID.toUpperCase(), 'City')).toBe(UUID.toUpperCase());
    expect(isId(UUID)).toBe(true);
  });

  it.each(['toString', '__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'valueOf', '', ' ', 'not-a-uuid', `${UUID} `, ` ${UUID}`, `${UUID}\n`, `${UUID}0`, UUID.replace(/-/g, ''), '../../etc/passwd', 'a'.repeat(10_000)])(
    'refuses the string %j with code invalid',
    (id) => {
      expect(() => requireId(id, 'City')).toThrow(InvalidInputError);
      try {
        requireId(id, 'City');
      } catch (error) {
        expect(error).toBeInstanceOf(DataError);
        expect((error as DataError).code).toBe('invalid');
        // the message names the record, never the value (it may be huge or hostile)
        expect((error as DataError).message).toBe('City: the id must be a UUID.');
      }
      expect(isId(id)).toBe(false);
    },
  );

  it.each([123, 0, null, undefined, {}, [], [UUID], true, Symbol('id'), 10n, () => UUID, { toString: () => UUID }])('refuses a value that is not a string (%s)', (id) => {
    expect(() => requireId(id, 'Roster')).toThrow(InvalidInputError);
  });

  it('accepts every id in the committed fixtures (they are all UUIDs)', async () => {
    const { fixtureRecords, fixtureSchemas } = await import('./fixtures');
    let checked = 0;
    for (const schema of fixtureSchemas()) {
      for (const record of fixtureRecords<{ id?: unknown }>(schema)) {
        if (record.id === undefined) continue;
        expect(isId(record.id), `${schema} ${String(record.id)}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  });
});
