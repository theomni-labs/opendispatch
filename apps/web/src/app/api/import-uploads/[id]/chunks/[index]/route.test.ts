// SPDX-License-Identifier: AGPL-3.0-only
// Chunk route: server context, streamed body.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '@/lib/data/errors';

const env = vi.hoisted(() => ({ ctx: { customerId: 'tenant-from-session', userId: 'u', role: 'administrator' }, put: vi.fn() }));
vi.mock('@/lib/data/context', () => ({ requireRequestContext: async () => env.ctx }));
vi.mock('@/lib/data/import-uploads', () => ({ putImportUploadChunk: env.put }));

const { PUT } = await import('./route');

const ID = '3f1d2c4b-5a69-4e7f-8a1b-2c3d4e5f6a7b';
const params = (index = '0') => ({ params: Promise.resolve({ id: ID, index }) });
function chunk(bytes: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/import-uploads/${ID}/chunks/0`, {
    method: 'PUT',
    body: bytes,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-length': String(bytes.length), 'x-role': 'planner', ...headers },
  });
}

afterEach(() => env.put.mockReset());

describe('PUT /api/import-uploads/{id}/chunks/{index}', () => {
  it('streams the body with its length to the data layer, with the context the server built', async () => {
    env.put.mockImplementation(async (_ctx: unknown, _id: string, _i: number, bytes: { stream: ReadableStream<Uint8Array>; length: number }) => {
      expect(await new Response(bytes.stream).text()).toBe('RecordID,CaseNumber\n');
      return { received_chunks: [0, 2] };
    });
    const res = await PUT(chunk('RecordID,CaseNumber\n'), params('2'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { received: [0, 2] } });
    const [ctx, id, index, bytes] = env.put.mock.calls[0] as [unknown, string, number, { length: number }];
    expect(ctx).toBe(env.ctx);
    expect([id, index, bytes.length]).toEqual([ID, 2, 22]);
  });

  it('maps the data layer errors to their status', async () => {
    env.put.mockRejectedValueOnce(new NotFoundError('Import upload not found: start the upload again.'));
    const gone = await PUT(chunk('x'), params());
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ ok: false, code: 'not_found' });
    env.put.mockRejectedValueOnce(new ForbiddenError('planner may not edit'));
    expect((await PUT(chunk('x'), params())).status).toBe(403);
    env.put.mockRejectedValueOnce(new Error('socket hang up with a secret'));
    const odd = await PUT(chunk('x'), params());
    expect(odd.status).toBe(500);
    expect(JSON.stringify(await odd.json())).not.toContain('secret');
  });

  it('refuses another site, a missing or oversized length and a bad index before the data layer', async () => {
    expect((await PUT(chunk('x', { origin: 'https://evil.example' }), params())).status).toBe(403);
    expect((await PUT(chunk('x', { 'content-length': String(8 * 2 ** 20 + 1) }), params())).status).toBe(400);
    expect((await PUT(chunk('x'), params('-1'))).status).toBe(400);
    expect((await PUT(chunk('x'), params('1e3'))).status).toBe(400);
    expect(env.put).not.toHaveBeenCalled();
  });
});
