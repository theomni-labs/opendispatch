// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEMO_MODE_COOKIE,
  DEMO_MODE_MAX_AGE_SECONDS,
  isUsableSecret,
  parseDemoSession,
  signDemoMode,
  verifyDemoMode,
} from './demo-session';

const secret = 'test-secret-not-a-real-one-0123456789';
const now = 1_800_000_000;

describe('demo switcher choice and secret', () => {
  // Review finding: a copy of.env.example must not become a working signing secret.
  it('refuses short, placeholder and repetitive secrets', () => {
    for (const bad of [undefined, '', 'short', 'replace-with-32-random-bytes', 'replace-with-32-random-bytes-and-more-text', 'a'.repeat(40), '0'.repeat(64), 'changeme-changeme-changeme-changeme', 'your-secret-goes-here-your-secret-goes']) {
      expect(isUsableSecret(bad), String(bad)).toBe(false);
      expect(() => signDemoMode('private', bad, now)).toThrow(/DEMO_SESSION_SECRET/);
    }
    expect(isUsableSecret('9f2c6b1e0a7d4c83b5e1f0a2d6c9b7e4a1f3d5c8e2b0a4c6d8f1e3a5b7c9d2f0')).toBe(true);
  });

  it('does not accept the value shipped in .env.example', () => {
    const example = readFileSync(new URL('../../../../../.env.example', import.meta.url), 'utf8');
    const line = example.split('\n').find((l) => l.startsWith('DEMO_SESSION_SECRET='));
    expect(line).toBeDefined();
    const value = line!.slice('DEMO_SESSION_SECRET='.length).trim();
    expect(isUsableSecret(value)).toBe(false);
    for (const key of ['DEMO_EMERGENCY_ADMIN_PASSWORD=', 'DEMO_EMERGENCY_ADMIN_TOTP=']) {
      const l = example.split('\n').find((x) => x.startsWith(key));
      expect(l?.slice(key.length).trim(), key).toBe('');
    }
  });

  it('validates against the fixed enums', () => {
    expect(parseDemoSession({ role: 'root', installMode: 'private', zoneIds: [] })).toBeNull();
    expect(parseDemoSession({ role: 'planner', installMode: 'cloud', zoneIds: [] })).toBeNull();
    expect(parseDemoSession({ role: 'planner', installMode: 'private', zoneIds: 'all' })).toBeNull();
    expect(parseDemoSession({ role: 'planner', installMode: 'private', zoneIds: ['ok', '../etc'] })).toBeNull();
    expect(parseDemoSession(null)).toBeNull();
  });

  it('refuses Change Approver outside private installs', () => {
    expect(parseDemoSession({ role: 'change_approver', installMode: 'shared', zoneIds: [] })).toBeNull();
    expect(parseDemoSession({ role: 'change_approver', installMode: 'private', zoneIds: [] })).not.toBeNull();
  });

  it('deduplicates zone ids', () => {
    expect(parseDemoSession({ role: 'planner', installMode: 'private', zoneIds: ['a', 'a', 'b'] })?.zoneIds).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------------------------
// The install mode of a person who has not signed in
// ---------------------------------------------------------------------------------------------

describe('demo mode cookie (pre-session install mode)', () => {
  it('has its own cookie name, apart from the session cookie, and outlives a session', () => {
    expect(DEMO_MODE_COOKIE).toBe('opendispatch_demo_mode');
    expect(DEMO_MODE_COOKIE).not.toBe('opendispatch_session');
    expect(DEMO_MODE_MAX_AGE_SECONDS).toBeGreaterThan(12 * 60 * 60);
  });

  it.each(['private', 'dedicated', 'shared'] as const)('round-trips %s', (mode) => {
    const token = signDemoMode(mode, secret, now);
    expect(verifyDemoMode(token, secret, now + 60)).toBe(mode);
  });

  it('defaults to private when the cookie is absent, empty, garbage, expired or tampered (never throws for those)', () => {
    expect(verifyDemoMode(undefined, secret, now)).toBe('private');
    expect(verifyDemoMode('', secret, now)).toBe('private');
    expect(verifyDemoMode('garbage', secret, now)).toBe('private');
    expect(verifyDemoMode('a.b.c', secret, now)).toBe('private');
    const shared = signDemoMode('shared', secret, now);
    expect(verifyDemoMode(shared, secret, now + DEMO_MODE_MAX_AGE_SECONDS + 1)).toBe('private');
    const [body, sig] = shared.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ v: 1, t: 'mode', exp: now + 999_999, mode: 'dedicated' })).toString('base64url');
    expect(verifyDemoMode(`${forged}.${sig}`, secret, now)).toBe('private');
    expect(verifyDemoMode(`${body}.${sig.slice(0, -2)}AA`, secret, now)).toBe('private');
    expect(verifyDemoMode(signDemoMode('shared', 'another-secret-value-not-the-same-0123456789', now), secret, now)).toBe('private');
  });

  it('refuses a mode that is not one of the three install modes, when signing', () => {
    expect(() => signDemoMode('cloud' as never, secret, now)).toThrow(/install mode/i);
  });

  it('fails closed without a usable secret once a token is present ', () => {
    expect(() => signDemoMode('shared', undefined, now)).toThrow(/DEMO_SESSION_SECRET/);
    expect(() => verifyDemoMode('a.b', 'short', now)).toThrow(/DEMO_SESSION_SECRET/);
    expect(verifyDemoMode(undefined, undefined, now)).toBe('private');
  });
});
