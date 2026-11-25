// SPDX-License-Identifier: AGPL-3.0-only
// Sign-in calls to the api; caller sets cookies.

import type { DemoSignInRequest, SignInResult } from '@/lib/types';
import { SESSION_COOKIE as SESSION_COOKIE_NAME, sessionCookieOf, takeStartedSession, type StartedSession } from './internal/business-client';

function apiBase(): string {
  const base = process.env['OPENDISPATCH_API_URL'];
  if (base === undefined || base === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  return base;
}

export type EmergencyViaGo =
  | { readonly outcome: 'invalid' | 'mfa_required' | 'invalid_credentials' | 'locked' }
  | { readonly outcome: 'signed_in'; readonly role: string; readonly installMode: string; readonly session: { readonly value: string; readonly maxAge: number } };

/** The emergency administrator's password (then code) checked at the api. Throws when the api cannot answer. */
export async function emergencyViaGo(body: { email: string; password: string; totp_code?: string }): Promise<EmergencyViaGo> {
  const res = await fetch(`${apiBase()}/auth/emergency`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', redirect: 'manual' });
  if (res.status === 400) return { outcome: 'invalid' };
  if (!res.ok) throw new Error(`The emergency sign-in answered ${String(res.status)}.`);
  const result = (await res.json()) as { outcome?: string; assigned_role?: string | null };
  switch (result.outcome) {
    case 'signed_in': {
      const session = sessionCookieOf(res);
      if (session === null || typeof result.assigned_role !== 'string') throw new Error('The api signed the emergency administrator in without a session.');
      const me = await fetch(`${apiBase()}/me`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${session.value}` }, cache: 'no-store' });
      if (!me.ok) throw new Error(`/me answered ${String(me.status)} after the emergency sign-in.`);
      return { outcome: 'signed_in', role: result.assigned_role, installMode: ((await me.json()) as { install_mode: string }).install_mode, session };
    }
    case 'mfa_required':
    case 'invalid_credentials':
    case 'locked':
      return { outcome: result.outcome };
    default:
      throw new Error(`Unexpected emergency sign-in outcome ${String(result.outcome)}.`);
  }
}

/** Ends the session at the api; returns the provider's own sign-out page when it names one. */
export async function logoutViaGo(session: string, locale: string): Promise<string | null> {
  const res = await fetch(`${apiBase()}/auth/logout?locale=${encodeURIComponent(locale)}`, { method: 'POST', headers: { cookie: `${SESSION_COOKIE_NAME}=${session}` }, cache: 'no-store' });
  if (!res.ok) return null;
  const next = ((await res.json()) as { redirect?: string }).redirect;
  return next !== undefined && /^https?:\/\//.test(next) ? next : null;
}

/** Passes a /auth/* request to the api as it is (cookies, query, body) and returns the answer unfollowed, redirects included. */
export async function proxyAuth(req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers();
  for (const name of ['cookie', 'content-type', 'accept-language']) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const res = await fetch(`${apiBase()}/auth/${path}${url.search}`, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : null, redirect: 'manual', cache: 'no-store' });
  const out = new Headers();
  for (const name of ['location', 'content-type', 'cache-control']) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  for (const cookie of res.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(res.status === 204 || (res.status >= 300 && res.status < 400) ? null : await res.arrayBuffer(), { status: res.status, headers: out });
}

export type DemoSignInOutcome =
  | { readonly outcome: 'invalid' | 'no_role_assigned' }
  | { readonly outcome: 'signed_in'; readonly result: SignInResult; readonly session: StartedSession };

/** The switcher's choice; Go checks, audits. */
// operationId: demoSignIn
export async function demoSignIn(body: DemoSignInRequest): Promise<DemoSignInOutcome> {
  const res = await fetch(`${apiBase()}/auth/demo/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  if (res.status === 400) return { outcome: 'invalid' };
  if (!res.ok) throw new Error(`The demo sign-in answered ${String(res.status)}.`);
  const result = (await res.json()) as SignInResult;
  if (result.outcome === 'no_role_assigned') return { outcome: 'no_role_assigned' };
  const session = sessionCookieOf(res);
  if (result.outcome !== 'signed_in' || session === null) throw new Error('The api signed a demo user in without a session.');
  return { outcome: 'signed_in', result, session };
}

/** The session a pre-session sign-in started. */
export function sessionOfSignIn(result: SignInResult): StartedSession | null {
  return takeStartedSession(result);
}
