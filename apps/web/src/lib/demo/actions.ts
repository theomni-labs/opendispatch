'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The sanctioned demo-only server actions, ; the sign-in actions are and the
// addendum). Deleted in oidc mode when the Keycloak token replaces the session cookie and Keycloak is the front door.
//
// What the browser may send:
//  - setDemoSession: a role, an install mode and zone ids, each checked against fixed lists (the enums, and the zone ids
//    the data layer reports). This is the one action with `role` and `installMode` fields (context-rules.test.ts names it).
//  - signInMock, signInEmergency: only what a person types on the sign-in pages (provider, subject and groups; e-mail,
//    password and code). NO role, customer, user, zone or install mode, in any type of any parameter. The role and zones of
//    the session come from the RESULT of the data function (the group rules for the mock provider, the Administrator for the
//    emergency account); the install mode from the pre-session context, that is the signed opendispatch_demo_mode cookie.
//  - signOutDemo: the language only.
// A customer, user id or context is never read from the browser: the customer and user come from the data layer.
//
// Cookies: `opendispatch_session` (Go's) and `opendispatch_demo_mode`.

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { moduleHref } from '@/i18n/module-routes';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { defaultLanding, getModule, isRole, scopeAppliesTo, type InstallMode } from '@/lib/access';
import { getDemoOptions, getPreSessionContext, getRequestContext } from '@/lib/data/context';
import { demoSignIn, emergencyViaGo, logoutViaGo, sessionOfSignIn } from '@/lib/data/auth-session';
import { isOidcMode } from '@/lib/data/context';
import { DataError } from '@/lib/data/errors';
import { emergencyAdminSignIn, mockSignIn, signOut } from '@/lib/data/identity';
import { DEMO_MODE_COOKIE, DEMO_MODE_MAX_AGE_SECONDS, isUsableSecret, parseDemoSession, signDemoMode, type DemoSession } from '@/lib/session/demo-session';
import type { SignInResult } from '@/lib/types';

/** Go's session cookie, in both modes. */
const SESSION_COOKIE = 'opendispatch_session';

/** Why the action refused. It never returns on success: it redirects. */
export type SetDemoSessionResult = { readonly ok: false; readonly error: 'invalid' | 'unknown_zone' | 'unavailable' };

/** What the switcher and the demo start page submit. Everything is validated again on the server. */
export interface DemoSessionInput {
  readonly role: string;
  readonly installMode: string;
  readonly zoneIds: readonly string[];
}

function localeOf(value: unknown): (typeof routing.locales)[number] {
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** The options of both demo cookies: HttpOnly, SameSite=Lax, Secure only when DEMO_COOKIE_SECURE=1, the whole site. */
const cookieOptions = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env['DEMO_COOKIE_SECURE'] === '1', path: '/', maxAge });

/**
 * Checks the input against the enums and the known zones, signs it, sets the cookies and redirects to
 * the landing page of the new role. Returns only when it refused. Writes the install mode cookie next to the session
 * cookie: the sign-in pages read it after the session has gone.
 */
export async function setDemoSession(input: DemoSessionInput, locale: string): Promise<SetDemoSessionResult> {
  const parsed = parseDemoSession(input);
  if (parsed === null) return { ok: false, error: 'invalid' };

  const options = await getDemoOptions();
  if (!options.rolesByInstallMode[parsed.installMode].includes(parsed.role)) return { ok: false, error: 'invalid' };

  const knownZones = new Set(options.zones.map((zone) => zone.id));
  if (parsed.zoneIds.some((id) => !knownZones.has(id))) return { ok: false, error: 'unknown_zone' };

  // Whole-install and remote-pool roles ignore the zone selection: send none.
  const session: DemoSession = {
    role: parsed.role,
    installMode: parsed.installMode,
    zoneIds: scopeAppliesTo(parsed.role) === 'assigned_zones' ? parsed.zoneIds : [],
  };

  const landing = defaultLanding(session.role, session.installMode);
  if (landing === null) return { ok: false, error: 'invalid' };

  let modeToken: string;
  try {
    modeToken = signDemoMode(session.installMode, process.env['DEMO_SESSION_SECRET'], nowSeconds());
  } catch (error) {
    // No usable secret. The browser gets only "unavailable" and no cookie; the server log says why.
    console.error(`Demo sign-in unavailable: ${(error as Error).message}`);
    return { ok: false, error: 'unavailable' };
  }

  let signedIn: Awaited<ReturnType<typeof demoSignIn>>;
  try {
    signedIn = await demoSignIn({ assigned_role: session.role, install_mode: session.installMode, zone_ids: [...session.zoneIds] });
  } catch (error) {
    return failWithReference(error, locale);
  }
  if (signedIn.outcome !== 'signed_in') {
    return signedIn.outcome === 'invalid' ? { ok: false, error: 'invalid' } : redirect({ href: '/sign-in/message/no-role', locale: localeOf(locale) });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, signedIn.session.value, cookieOptions(signedIn.session.maxAge));
  jar.set(DEMO_MODE_COOKIE, modeToken, cookieOptions(DEMO_MODE_MAX_AGE_SECONDS));

  return redirect({ href: moduleHref(getModule(landing.moduleId)), locale: localeOf(locale) });
}

// ---------------------------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------------------------

/**
 * What a person types in the mock provider's card. The data layer's own body (`mockSignIn`), and nothing else: there is
 * no role, customer, user, zone or install mode here, so none can be sent (an extra field is refused, see `signInMock`).
 */
export interface MockSignInInput {
  readonly provider_id: string;
  readonly subject: string;
  readonly groups: readonly string[];
}

/** What a person types on the emergency administrator page. The code is sent with the second step. Never stored, never logged. */
export interface EmergencySignInInput {
  readonly email: string;
  readonly password: string;
  readonly totp_code?: string;
}

/**
 * What signInMock returns when it does not redirect. `invalid`: the input was refused (a field that is not there, a value the
 * data layer does not allow); `unavailable`: there is no usable DEMO_SESSION_SECRET, so no session can be signed.
 */
export type SignInMockResult = { readonly ok: false; readonly error: 'invalid' | 'unavailable' };

/**
 * What signInEmergency returns when it does not redirect. `mfa_required`: the password is right, ask for the code (the page
 * keeps the password in its own state, not in the URL). `invalid_credentials` says only that: never which of e-mail,
 * password or code was wrong. `locked`: five failures, the account is locked until the demo is reset.
 */
export type SignInEmergencyResult =
  | { readonly ok: true; readonly next: 'mfa_required' }
  | { readonly ok: false; readonly error: 'invalid' | 'unavailable' | 'invalid_credentials' | 'locked' };

const MOCK_KEYS: ReadonlySet<string> = new Set(['provider_id', 'subject', 'groups']);
const EMERGENCY_KEYS: ReadonlySet<string> = new Set(['email', 'password', 'totp_code']);
const MAX_GROUPS = 64;

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Readonly<Record<string, unknown>>, keys: ReadonlySet<string>): boolean => Object.keys(value).every((key) => keys.has(key));

/** The mock body, rebuilt from exactly its three fields; null for anything else, a forged extra field included. */
function mockBodyOf(input: unknown): { provider_id: string; subject: string; groups: string[] } | null {
  if (!isPlainObject(input) || !hasOnly(input, MOCK_KEYS)) return null;
  const { provider_id, subject, groups } = input;
  if (typeof provider_id !== 'string' || typeof subject !== 'string' || !Array.isArray(groups) || groups.length > MAX_GROUPS) return null;
  if (!groups.every((group): group is string => typeof group === 'string')) return null;
  return { provider_id, subject, groups: [...groups] };
}

/** The emergency body, rebuilt from its fields; `totp_code` is left out when it is not sent. */
function emergencyBodyOf(input: unknown): { email: string; password: string; totp_code?: string } | null {
  if (!isPlainObject(input) || !hasOnly(input, EMERGENCY_KEYS)) return null;
  const { email, password, totp_code } = input;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  if (totp_code === undefined) return { email, password };
  return typeof totp_code === 'string' ? { email, password, totp_code } : null;
}

/** `ODP-` and eight hex characters, as the data layer's reference codes. A reference is not a secret: it is shown and quoted to support. */
function newReference(): string {
  return `ODP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Something nobody expected went wrong while signing in: log it on the server under a reference (never a password, code or
 * input value: the name and the message of the error only) and send the person to the "something went wrong" page with it.
 */
function failWithReference(error: unknown, locale: string): never {
  const reference = newReference();
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message.slice(0, 300) : 'not an Error';
  console.error(`Sign-in failed (${reference}): ${name}: ${message}`);
  return redirect({ href: { pathname: '/sign-in/message/error', query: { ref: reference } }, locale: localeOf(locale) });
}

/** Sets Go's session; never returns. */
async function startSession(result: SignInResult, installMode: InstallMode, locale: string): Promise<never> {
  const role = result.assigned_role;
  if (!isRole(role)) return failWithReference(new Error('The data layer signed a person in without a role.'), locale);
  const landing = defaultLanding(role, installMode);
  if (landing === null) return failWithReference(new Error('The signed-in role has no landing page.'), locale);
  const session = sessionOfSignIn(result);
  if (session === null) return failWithReference(new Error('The api signed a person in without a session.'), locale);

  (await cookies()).set(SESSION_COOKIE, session.value, cookieOptions(session.maxAge));
  return redirect({ href: moduleHref(getModule(landing.moduleId)), locale: localeOf(locale) });
}

/** True, logged, if no mode cookie can be signed. */
function sessionUnavailable(): boolean {
  if (isUsableSecret(process.env['DEMO_SESSION_SECRET'])) return false;
  console.error('Demo sign-in unavailable: DEMO_SESSION_SECRET is not set to a usable value.');
  return true;
}

/**
 * Sign-in through the labelled mock provider. Builds the pre-session context on the server, calls `mockSignIn`,
 * and on `signed_in` signs the session from its result and redirects to the role's landing page. The other outcomes go to the
 * message pages: no matching group to /sign-in/message/no-role, a provider that refuses (or an account that is switched off) to
 * /sign-in/message/refused, and a provider that fails to /sign-in/message/error?ref=... Returns only when the input was refused.
 */
export async function signInMock(input: MockSignInInput, locale: string): Promise<SignInMockResult> {
  const body = mockBodyOf(input);
  if (body === null) return { ok: false, error: 'invalid' };
  if (sessionUnavailable()) return { ok: false, error: 'unavailable' };

  let pre: Awaited<ReturnType<typeof getPreSessionContext>>;
  let result: Awaited<ReturnType<typeof mockSignIn>>;
  try {
    pre = await getPreSessionContext();
    result = await mockSignIn(pre, body);
  } catch (error) {
    if (error instanceof DataError && error.code === 'invalid') return { ok: false, error: 'invalid' };
    return failWithReference(error, locale);
  }

  const target = localeOf(locale);
  switch (result.outcome) {
    case 'signed_in':
      return startSession(result, pre.installMode, locale);
    case 'no_role_assigned':
      return redirect({ href: '/sign-in/message/no-role', locale: target });
    case 'refused_by_provider':
    case 'locked':
      return redirect({ href: '/sign-in/message/refused', locale: target });
    case 'error':
      return redirect({ href: { pathname: '/sign-in/message/error', query: { ref: result.reference_code ?? newReference() } }, locale: target });
    default:
      // mfa_required and invalid_credentials belong to the emergency sign-in; the mock provider never gives them.
      return failWithReference(new Error(`Unexpected mock sign-in outcome ${result.outcome}.`), locale);
  }
}

/**
 * Emergency administrator sign-in. Two calls from one page: the e-mail and password first (`mfa_required` when
 * they are right), then the same with the authenticator code. On `signed_in` it signs the session from the result (the
 * Administrator) and redirects to its landing page. The password and the code are passed to the data layer and nowhere else:
 * not stored, not logged, not put in any result.
 */
export async function signInEmergency(input: EmergencySignInInput, locale: string): Promise<SignInEmergencyResult> {
  const body = emergencyBodyOf(input);
  if (body === null) return { ok: false, error: 'invalid' };
  if (isOidcMode()) return emergencyThroughGo(body, locale);
  if (sessionUnavailable()) return { ok: false, error: 'unavailable' };

  let pre: Awaited<ReturnType<typeof getPreSessionContext>>;
  let result: Awaited<ReturnType<typeof emergencyAdminSignIn>>;
  try {
    pre = await getPreSessionContext();
    result = await emergencyAdminSignIn(pre, body);
  } catch (error) {
    if (error instanceof DataError && error.code === 'invalid') return { ok: false, error: 'invalid' };
    return failWithReference(error, locale);
  }

  switch (result.outcome) {
    case 'signed_in':
      return startSession(result, pre.installMode, locale);
    case 'mfa_required':
      // Asked for only when no code was sent. A data layer that asks again after a code is a bug, not a second step.
      return body.totp_code === undefined ? { ok: true, next: 'mfa_required' } : failWithReference(new Error('The data layer asked for a code that was sent.'), locale);
    case 'invalid_credentials':
      return { ok: false, error: 'invalid_credentials' };
    case 'locked':
      return { ok: false, error: 'locked' };
    default:
      return failWithReference(new Error(`Unexpected emergency sign-in outcome ${result.outcome}.`), locale);
  }
}

/**
 * Signs out: records `auth.sign_out` while the session still exists, then clears the SESSION cookie and goes to the
 * Signed out page. The install mode cookie stays. A request with no valid session has nothing to audit: it clears the cookie
 * and goes on. Signing out never fails for the person: if the audit cannot be written, that is logged on the server and the
 * cookie is cleared all the same.
 */
export async function signOutDemo(locale: string): Promise<void> {
  if (isOidcMode()) return signOutThroughGo(locale);
  try {
    const ctx = await getRequestContext();
    if (ctx !== null) await signOut(ctx);
  } catch (error) {
    console.error(`Sign-out could not be audited: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'not an Error'}`);
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect({ href: '/signed-out', locale: localeOf(locale) });
}

// oidc mode: the session belongs to the api. These two relay its answer and its session cookie; nothing is decided here.


async function emergencyThroughGo(body: { email: string; password: string; totp_code?: string }, locale: string): Promise<SignInEmergencyResult> {
  let result: Awaited<ReturnType<typeof emergencyViaGo>>;
  try {
    result = await emergencyViaGo(body);
  } catch (error) {
    return failWithReference(error, locale);
  }
  switch (result.outcome) {
    case 'invalid':
      return { ok: false, error: 'invalid' };
    case 'invalid_credentials':
      return { ok: false, error: 'invalid_credentials' };
    case 'locked':
      return { ok: false, error: 'locked' };
    case 'mfa_required':
      return body.totp_code === undefined ? { ok: true, next: 'mfa_required' } : failWithReference(new Error('The api asked for a code that was sent.'), locale);
    case 'signed_in': {
      if (!isRole(result.role)) return failWithReference(new Error('The signed-in role is unknown.'), locale);
      const landing = defaultLanding(result.role, result.installMode as Parameters<typeof defaultLanding>[1]);
      if (landing === null) return failWithReference(new Error('The signed-in role has no landing page.'), locale);
      (await cookies()).set(SESSION_COOKIE, result.session.value, cookieOptions(result.session.maxAge));
      return redirect({ href: moduleHref(getModule(landing.moduleId)), locale: localeOf(locale) });
    }
  }
}

/** Ends the session at the api and clears the cookie. Never fails for the person. */
async function signOutThroughGo(locale: string): Promise<void> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  let next: string | null = null;
  if (session !== undefined) {
    try {
      next = await logoutViaGo(session, localeOf(locale));
    } catch (error) {
      console.error(`Sign-out could not reach the session service: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'not an Error'}`);
    }
  }
  jar.delete(SESSION_COOKIE);
  if (next !== null) return nextRedirect(next);
  redirect({ href: '/signed-out', locale: localeOf(locale) });
}
