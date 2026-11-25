// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLES } from '../../apps/web/src/lib/access';
import { THEME, staleAssets } from './theme-assets.mjs';
import { base32, demoUsers, fromBase32, generatePassword, readAccounts, readState, tenantsJson } from './state.mjs';

const ROOT = path.join(import.meta.dirname, '../..');
const realm = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/keycloak/realm-opendispatch-dev.json'), 'utf8')) as Record<string, unknown> & {
  clients: Array<Record<string, unknown> & { attributes: Record<string, string>; protocolMappers: Array<{ protocolMapper: string }> }>;
  users: Array<Record<string, unknown>>;
};

describe('dev Keycloak realm', () => {
  it('has one demo user per OpenDispatch role and one in no group', () => {
    const users = demoUsers();
    for (const role of ROLES) expect(users.some((u) => u.role === role), role).toBe(true);
    expect(users.filter((u) => u.role === 'none').map((u) => u.groups)).toEqual([[]]);
  });

  it('holds no password, secret or key', () => {
    const text = JSON.stringify(realm);
    expect(text).not.toMatch(/"(credentials|secret|value|secretData)"\s*:/);
    for (const u of realm.users) expect(u['credentials']).toBeUndefined();
  });

  it('is locked down for a public demo', () => {
    expect(realm).toMatchObject({ registrationAllowed: false, resetPasswordAllowed: false, bruteForceProtected: true, permanentLockout: false, loginTheme: 'opendispatch' });
    expect(realm['failureFactor']).toBeLessThanOrEqual(5);
    expect(String(realm['passwordPolicy'])).toContain('length(20)');
    const [client] = realm.clients;
    expect(client).toMatchObject({ clientId: 'opendispatch-web', publicClient: false, directAccessGrantsEnabled: false, implicitFlowEnabled: false });
    expect(client?.attributes['pkce.code.challenge.method']).toBe('S256');
    expect(client?.protocolMappers.map((m) => m.protocolMapper)).toEqual(expect.arrayContaining(['oidc-group-membership-mapper', 'oidc-amr-mapper']));
  });
});

describe('dev Keycloak script', () => {
  it('makes strong passwords from an unambiguous alphabet', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
    for (const p of seen) expect(p).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{20}$/);
  });

  it('round-trips base32 (authenticator keys)', () => {
    const raw = Buffer.from('abcdefghij0123456789');
    expect(fromBase32(base32(raw))).toEqual(raw);
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('reads its state and writes a tenants file without the secret', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-kc-'));
    fs.writeFileSync(path.join(dir, 'keycloak.env'), 'OPENDISPATCH_KC_PORT=18999\nOPENDISPATCH_KC_PUBLIC_URL=\nOPENDISPATCH_KC_CLIENT_SECRET=s\n');
    const state = readState(dir);
    expect(state?.issuer).toBe('http://127.0.0.1:18999/idp/realms/opendispatch');
    fs.writeFileSync(path.join(dir, 'keycloak.env'), 'OPENDISPATCH_KC_PORT=18999\nOPENDISPATCH_KC_PUBLIC_URL=https://demo.example\n');
    const pub = readState(dir);
    expect(pub?.issuer).toBe('https://demo.example/idp/realms/opendispatch');
    if (pub === null) throw new Error('no state');
    const [t] = tenantsJson(pub, 'https://demo.example', '8f3c2a10-5b7e-4d64-9a21-3c6e0d7b1a55');
    expect(t).toMatchObject({ client_secret_env: 'OPENDISPATCH_KC_CLIENT_SECRET', redirect_uri: 'https://demo.example/auth/callback', allow_insecure_http: false });
    expect(JSON.stringify(t)).not.toContain('"s"');
    const pw = generatePassword();
    fs.writeFileSync(path.join(dir, 'logins.txt'), `# c\nusername role password authenticator key\nmfa.demo viewer_auditor ${pw} MZXW6YTBOI\n`);
    expect(readAccounts(dir).get('mfa.demo')).toEqual({ password: pw, totp: 'MZXW6YTBOI' });
    fs.rmSync(dir, { recursive: true });
  });
});

describe('opendispatch login theme', () => {
  it('has the design system tokens and the bundled fonts, unchanged (pnpm keycloak:theme)', () => {
    expect(staleAssets()).toEqual([]);
  });

  it('loads nothing from the internet and sets no colour of its own', () => {
    const css = fs.readFileSync(path.join(THEME, 'css/opendispatch.css'), 'utf8');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(css).not.toMatch(/\b(margin|padding)-(left|right)\b|\b(left|right)\s*:/);
    for (const f of ['fonts.css', 'tokens.css']) expect(fs.readFileSync(path.join(THEME, 'css', f), 'utf8')).not.toMatch(/https?:\/\//);
  });

  it('speaks English and Arabic', () => {
    const props = fs.readFileSync(path.join(THEME, '../theme.properties'), 'utf8');
    expect(props).toMatch(/^parent=keycloak\.v2$/m);
    expect(props).toMatch(/^locales=en,ar$/m);
    expect(props).toMatch(/^darkMode=false$/m);
    const keys = (f: string) =>
      fs
        .readFileSync(path.join(THEME, '../messages', f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('=')[0]);
    expect(keys('messages_ar.properties')).toEqual(keys('messages_en.properties'));
  });
});
