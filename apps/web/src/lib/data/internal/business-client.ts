// SPDX-License-Identifier: AGPL-3.0-only
// HTTP client for the Go business API.

import { signDemoMode } from '../../session/demo-session';
import { ConflictError, DataError, ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from '../errors';
import type { PreSessionContext, RequestContext } from '../guard';

/** Go's session cookie, in both modes. */
export const SESSION_COOKIE = 'opendispatch_session';

/** The signed install mode cookie. */
const MODE_COOKIE = 'opendispatch_demo_mode';

function baseUrl(): string {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  return url;
}

async function errorFor(status: number, res: Response): Promise<DataError> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
  const message = typeof body.error === 'string' ? body.error : res.statusText;
  const error = errorOfStatus(status, message);
  if (typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)) error.reason = body.code;
  return error;
}

function errorOfStatus(status: number, message: string): DataError {
  if (status === 401) return new UnauthenticatedError(message);
  if (status === 404) return new NotFoundError(message);
  if (status === 409) return new ConflictError(message);
  if (status === 403) return new ForbiddenError(message);
  if (status === 400) return new InvalidInputError(message);
  return new DataError('invalid', message);
}

export interface BusinessRequest {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined;
  readonly body?: unknown;
  /** Raw bytes, streamed (instead of `body`). */
  readonly bytes?: { readonly stream: ReadableStream<Uint8Array>; readonly length: number } | undefined;
}

/** True when people sign in through their identity provider; false for the demo role switcher (dev, CI and review builds). */
export function oidcMode(): boolean {
  return process.env['OPENDISPATCH_AUTH_MODE'] === 'oidc';
}

/** Tests: a session for a request-less ctx. */
export type TestSessionSource = (ctx: RequestContext, renew: boolean) => Promise<string | null>;

// Global: survives vi.resetModules in tests.
const TEST_KEY = Symbol.for('opendispatch.testSessionSource');
const holder = globalThis as { [TEST_KEY]?: TestSessionSource | undefined };

const bound = new WeakMap<RequestContext, string>();

/** The session a context was read from. */
export function bindSession(ctx: RequestContext, session: string): void {
  bound.set(ctx, session);
}

/** Test support only. */
export function setTestSessionSource(source: TestSessionSource | undefined): void {
  holder[TEST_KEY] = source;
}

async function sessionFor(ctx: RequestContext, renew: boolean): Promise<string | null> {
  const own = bound.get(ctx);
  if (own !== undefined) return own;
  const testSessions = holder[TEST_KEY];
  if (testSessions !== undefined) return testSessions(ctx, renew);
  const { cookies } = await import('next/headers');
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

async function send(ctx: RequestContext, path: string, req: BusinessRequest, renew: boolean): Promise<Response> {
  const session = await sessionFor(ctx, renew);
  const cookie = session === null ? {} : { cookie: `${SESSION_COOKIE}=${session}` };
  if (req.bytes !== undefined) {
    // streamed, never buffered (duplex: half)
    const init: RequestInit & { duplex: 'half' } = {
      method: req.method ?? 'PUT',
      headers: { ...cookie, 'content-type': 'application/octet-stream', 'content-length': String(req.bytes.length) },
      cache: 'no-store',
      body: req.bytes.stream,
      duplex: 'half',
    };
    return fetch(`${baseUrl()}${path}`, init);
  }
  return fetch(`${baseUrl()}${path}`, {
    method: req.method ?? 'GET',
    headers: { ...cookie, 'content-type': 'application/json' },
    cache: 'no-store',
    ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
  });
}

/** undefined on a GET 404/204; else throws non-2xx. */
export async function businessFetch<T>(ctx: RequestContext, path: string, req: BusinessRequest = {}): Promise<T | undefined> {
  let res = await send(ctx, path, req, false);
  // A test session Go ended: start another once.
  if (res.status === 401 && holder[TEST_KEY] !== undefined && !bound.has(ctx) && req.bytes === undefined) res = await send(ctx, path, req, true);
  if (res.status === 404 && (req.method ?? 'GET') === 'GET') return undefined;
  if (!res.ok) throw await errorFor(res.status, res);
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}

/** A session cookie: value and lifetime. */
export interface StartedSession {
  readonly value: string;
  readonly maxAge: number;
}

/** The session cookie an answer sets, or null. */
export function sessionCookieOf(res: Response): StartedSession | null {
  for (const line of res.headers.getSetCookie()) {
    const [pair = '', ...attrs] = line.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    if (pair.slice(0, eq) !== SESSION_COOKIE) continue;
    const value = pair.slice(eq + 1);
    if (value === '') continue;
    const maxAge = Number(attrs.find((a) => a.toLowerCase().startsWith('max-age='))?.slice(8));
    return { value, maxAge: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 12 * 60 * 60 };
  }
  return null;
}

const started = new WeakMap<object, StartedSession>();

/** The session a sign-in started, once. */
export function takeStartedSession(result: object): StartedSession | null {
  const found = started.get(result) ?? null;
  started.delete(result);
  return found;
}

/** A pre-session sign-in, mode in a cookie. */
export async function preSessionPost<T extends object>(pre: PreSessionContext, path: string, body: unknown): Promise<T> {
  const options = await fetch(`${baseUrl()}/auth/demo/options`, { cache: 'no-store' });
  if (options.status === 404) throw new ForbiddenError('The demo sign-in is off: people sign in through their identity provider.');
  if (!options.ok) throw await errorFor(options.status, options);
  // Go serves one demo customer: no other.
  if (((await options.json()) as { customer_id?: unknown }).customer_id !== pre.customerId) throw new ForbiddenError('Sign-in is refused: the customer is not known.');
  const mode = signDemoMode(pre.installMode, process.env['DEMO_SESSION_SECRET'], Math.floor((performance.timeOrigin + performance.now()) / 1000));
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { cookie: `${MODE_COOKIE}=${mode}`, 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFor(res.status, res);
  const result = (await res.json()) as T;
  const session = sessionCookieOf(res);
  if (session !== null) started.set(result, session);
  return result;
}
