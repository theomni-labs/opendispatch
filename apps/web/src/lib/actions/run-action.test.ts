// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { newReference, runAction } from './run-action';
import { isActionResult } from './types';

// runAction is the server half of every write. Next's cache and the session are stood in for; the data functions are
// stand-ins that throw what the real ones throw (lib/data/errors.ts).
const mocks = vi.hoisted(() => ({ ctx: null as RequestContext | null, revalidate: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/data/context', () => ({
  requireRequestContext: async () => {
    // The real one throws UnauthenticatedError; the class is imported below, after the mock is in place.
    if (mocks.ctx === null) throw new (await import('@/lib/data/errors')).UnauthenticatedError();
    return mocks.ctx;
  },
}));

const admin: RequestContext = {
  customerId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-0000000000aa',
  role: 'administrator',
  zoneScope: { kind: 'whole_install' },
  installMode: 'private',
};

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.ctx = admin;
  mocks.revalidate.mockReset();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe('runAction: success', () => {
  it('builds the context on the server, hands it to the data function and returns its result', async () => {
    const seen: RequestContext[] = [];
    const result = await runAction((ctx) => {
      seen.push(ctx);
      return { id: 'u1' };
    });
    expect(result).toEqual({ ok: true, data: { id: 'u1' } });
    expect(seen).toEqual([admin]);
  });

  it('awaits an async data function (oidc mode calls the api)', async () => {
    await expect(runAction(async () => 7)).resolves.toEqual({ ok: true, data: 7 });
  });

  it('refreshes each path in both languages after a successful write, and only then', async () => {
    await runAction(() => 1, { revalidate: ['/admin/users-roles', '/admin/audit-log'] });
    expect(mocks.revalidate.mock.calls.map((c) => c[0])).toEqual(['/en/admin/users-roles', '/ar/admin/users-roles', '/en/admin/audit-log', '/ar/admin/audit-log']);
    mocks.revalidate.mockReset();
    await runAction(() => 1, { revalidate: '/admin/users-roles' });
    expect(mocks.revalidate).toHaveBeenCalledTimes(2);
  });

  it('ignores a path that is not a plain absolute path (a query string, a relative path)', async () => {
    await runAction(() => 1, { revalidate: ['admin/x', '/admin/x?tab=roles'] });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('keeps a saved change a success when the refresh itself fails, and logs it without the error message', async () => {
    mocks.revalidate.mockImplementation(() => {
      throw new Error('cache secret-in-message');
    });
    await expect(runAction(() => 'saved', { revalidate: '/admin/x' })).resolves.toEqual({ ok: true, data: 'saved' });
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('secret-in-message');
  });
});

describe('runAction: the data layer errors keep their code and their English message', () => {
  it.each([
    ['forbidden', new ForbiddenError('administrator may not edit admin.users_roles.')],
    ['not_found', new NotFoundError('User not found.')],
    ['invalid', new InvalidInputError('User: email has the wrong format.')],
    ['conflict', new ConflictError('The last active Administrator cannot be disabled.')],
    ['unauthenticated', new UnauthenticatedError()],
  ] as const)('%s', async (code, error) => {
    const result = await runAction(() => {
      throw error;
    });
    expect(result).toEqual({ ok: false, code, message: error.message });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('answers `unauthenticated` when there is no session, without calling the data function', async () => {
    mocks.ctx = null;
    const fn = vi.fn();
    const result = await runAction(fn, { revalidate: '/admin/x' });
    expect(result).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('does not refresh anything when the write failed', async () => {
    await runAction(
      () => {
        throw new ConflictError('nope');
      },
      { revalidate: '/admin/x' },
    );
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('passes the api reason code on with the failure', async () => {
    const result = await runAction(() => {
      const error = new ConflictError('Import: the file storage is not available.');
      error.reason = 'STORAGE_UNAVAILABLE';
      throw error;
    });
    expect(result).toEqual({ ok: false, code: 'conflict', message: 'Import: the file storage is not available.', reason: 'STORAGE_UNAVAILABLE' });
    expect(await runAction(() => Promise.reject(new ConflictError('x')))).toEqual({ ok: false, code: 'conflict', message: 'x' });
  });
});

describe('runAction: an unexpected error', () => {
  const boom = () => {
    throw new TypeError('Cannot read properties of null (reading email) for input {"email":"secret@example.test","password":"hunter2"}');
  };

  it('returns code unexpected with a reference ODP- and 8 hex characters, and no detail from the error', async () => {
    const result = await runAction(boom);
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    if (result.ok) throw new Error('unreachable');
    expect(result.reference).toMatch(/^ODP-[0-9A-F]{8}$/);
    expect(JSON.stringify(result)).not.toMatch(/secret@example|hunter2|Cannot read/);
  });

  it('logs the reference and the error name on the server, and never the message or the input values', async () => {
    const result = await runAction(boom);
    if (result.ok) throw new Error('unreachable');
    const logged = errorLog.mock.calls.flat().join('\n');
    expect(logged).toContain(result.reference);
    expect(logged).toContain('TypeError');
    expect(logged).not.toMatch(/secret@example|hunter2|Cannot read|password/);
  });

  it('handles a thrown value that is not an Error', async () => {
    const result = await runAction(() => {
      throw 'a string with a token abc123';
    });
    expect(result).toMatchObject({ ok: false, code: 'unexpected' });
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('abc123');
  });

  it('gives a different reference each time', () => {
    expect(newReference()).not.toBe(newReference());
    expect(newReference()).toMatch(/^ODP-[0-9A-F]{8}$/);
  });
});

describe('isActionResult', () => {
  it('accepts the two shapes and refuses anything else', () => {
    expect(isActionResult({ ok: true, data: null })).toBe(true);
    expect(isActionResult({ ok: false, code: 'conflict', message: 'x' })).toBe(true);
    expect(isActionResult({ ok: false, code: 'teapot', message: 'x' })).toBe(false);
    expect(isActionResult({ ok: false, code: 'conflict' })).toBe(false);
    expect(isActionResult({ ok: true })).toBe(false);
    expect(isActionResult(null)).toBe(false);
    expect(isActionResult('ok')).toBe(false);
  });
});
