// SPDX-License-Identifier: AGPL-3.0-only
// Switcher choice and the signed mode cookie.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { INSTALL_MODES, ROLES, isInstallMode, isRole, type InstallMode, type Role } from '@/lib/access';

export interface DemoSession {
  readonly role: Role;
  readonly installMode: InstallMode;
  /** Zone ids chosen in the switcher. Ignored for roles whose scope is the whole install or the remote pool. */
  readonly zoneIds: readonly string[];
}

const ZONE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_ZONES = 64;

const b64 = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

function mac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

const MIN_SECRET_LENGTH = 32;
// Values that ship in documentation or examples. A copy of .env.example must not become a working secret.
const PLACEHOLDER_SECRET = /replace|change-?me|placeholder|example|your[-_ ]?secret/i;

/** Exported for the test that checks .env.example: is this value usable as the signing secret? */
export function isUsableSecret(secret: string | undefined): secret is string {
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) return false;
  if (PLACEHOLDER_SECRET.test(secret)) return false;
  return new Set(secret).size >= 8; // not "aaaa..." or "0000..."
}

function requireSecret(secret: string | undefined): string {
  if (!isUsableSecret(secret)) {
    // Fail closed. Set DEMO_SESSION_SECRET in .env.local (see .env.example). Never hard-code one.
    throw new Error(
      `DEMO_SESSION_SECRET is not set to a usable value (at least ${MIN_SECRET_LENGTH} random characters, not a placeholder; generate one with "openssl rand -hex 32"). The demo session cannot be signed or read.`,
    );
  }
  return secret;
}

/** Validates and normalises what the switcher submits. Returns null for anything outside the fixed enums. */
export function parseDemoSession(input: unknown): DemoSession | null {
  if (typeof input !== 'object' || input === null) return null;
  const { role, installMode, zoneIds } = input as Record<string, unknown>;
  if (!isRole(role) || !isInstallMode(installMode)) return null;
  if (!Array.isArray(zoneIds) || zoneIds.length > MAX_ZONES) return null;
  const zones: string[] = [];
  for (const id of zoneIds) {
    if (typeof id !== 'string' || !ZONE_ID.test(id)) return null;
    if (!zones.includes(id)) zones.push(id);
  }
  // Change Approver exists only in private installs.
  if (role === 'change_approver' && installMode !== 'private') return null;
  return { role, installMode, zoneIds: zones };
}

/** A signed, fresh token's payload, or null. */
function openToken(token: string | undefined, secret: string | undefined, nowSeconds: number): Record<string, unknown> | null {
  if (token === undefined || token === '') return null;
  const key = requireSecret(secret);
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];

  const expected = mac(body, key);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const { v, exp } = payload as Record<string, unknown>;
  if (v !== 1 || typeof exp !== 'number' || exp <= nowSeconds) return null;
  return payload as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// The install mode of a person who has not signed in
// ---------------------------------------------------------------------------------------------
//
// A signed-out visitor has no session, but the sign-in pages still need to know which install they are on (Change
// Approver exists only in private installs, the sign-in policy differs). The demo start page writes this second signed
// cookie next to the session cookie, and it survives sign-out. It carries the install mode and nothing else: no role,
// no user, no zones. Missing, invalid or expired means `private`, the default of a stand-alone install. in oidc mode the
// install's configuration replaces it.

export const DEMO_MODE_COOKIE = 'opendispatch_demo_mode';
/** 30 days: the cookie outlives every session and every sign-out. */
export const DEMO_MODE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_DEMO_MODE: InstallMode = 'private';

export function signDemoMode(mode: InstallMode, secret: string | undefined, nowSeconds: number): string {
  if (!isInstallMode(mode)) throw new Error('Not an install mode.');
  const key = requireSecret(secret);
  const body = b64(JSON.stringify({ v: 1, t: 'mode', exp: nowSeconds + DEMO_MODE_MAX_AGE_SECONDS, mode }));
  return `${body}.${b64(mac(body, key))}`;
}

/** The install mode a signed cookie holds; `private` for a cookie that is absent, not valid or expired. */
export function verifyDemoMode(token: string | undefined, secret: string | undefined, nowSeconds: number): InstallMode {
  const payload = openToken(token, secret, nowSeconds);
  if (payload === null || payload['t'] !== 'mode') return DEFAULT_DEMO_MODE;
  return isInstallMode(payload['mode']) ? payload['mode'] : DEFAULT_DEMO_MODE;
}

export const DEMO_ROLES: readonly Role[] = ROLES;
export const DEMO_INSTALL_MODES: readonly InstallMode[] = INSTALL_MODES;
