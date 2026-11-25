// SPDX-License-Identifier: AGPL-3.0-only
import { runAction } from '@/lib/actions/run-action';
import type { ActionFailure } from '@/lib/actions/types';
import { putImportUploadChunk } from '@/lib/data/import-uploads';

// Rule 2: runAction builds the context server-side
const STATUS: Readonly<Record<ActionFailure['code'], number>> = { unauthenticated: 401, forbidden: 403, not_found: 404, invalid: 400, conflict: 409, unexpected: 500 };

const MAX_CHUNK = 8 * 1024 * 1024;

function refuse(code: ActionFailure['code'], message: string): Response {
  return Response.json({ ok: false, code, message } satisfies ActionFailure, { status: STATUS[code] });
}

// Another site's page may not send chunks
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return req.headers.get('sec-fetch-site') !== 'cross-site';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  return host !== null && new URL(origin).host === host;
}

export async function PUT(req: Request, route: { params: Promise<{ id: string; index: string }> }): Promise<Response> {
  const { id, index } = await route.params;
  if (!sameOrigin(req)) return refuse('forbidden', 'Import upload: a chunk must come from this site.');
  const length = Number(req.headers.get('content-length'));
  if (req.body === null || !Number.isSafeInteger(length) || length < 1 || length > MAX_CHUNK) return refuse('invalid', 'Import upload: a chunk is 1 byte to 8 MiB with its length.');
  if (!/^\d{1,4}$/.test(index)) return refuse('invalid', 'Import upload: the chunk number must be a whole number.');
  const stream = req.body;
  const result = await runAction(async (ctx) => {
    const session = await putImportUploadChunk(ctx, id, Number(index), { stream, length });
    return { received: session.received_chunks };
  });
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.code] });
}
