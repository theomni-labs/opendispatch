// SPDX-License-Identifier: AGPL-3.0-only
import { isOidcMode } from '@/lib/data/context';
import { proxyAuth } from '@/lib/data/auth-session';

// The sign-in routes belong to the api; the identity provider sends the browser back to this site, so they pass through.
async function handle(req: Request, route: { params: Promise<{ path: string[] }> }): Promise<Response> {
  if (!isOidcMode()) return new Response(null, { status: 404 });
  return proxyAuth(req, (await route.params).path.join('/'));
}

export { handle as GET, handle as POST };
