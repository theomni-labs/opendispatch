// SPDX-License-Identifier: AGPL-3.0-only
// Dev Keycloak: users, state, passwords
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.join(import.meta.dirname, '../..');
export const REALM_FILE = path.join(ROOT, 'deploy/keycloak/realm-opendispatch-dev.json');
const RULES_FILE = path.join(ROOT, 'fixtures/admin/role_mappings.json');
export const REALM = 'opendispatch';
export const CLIENT_ID = 'opendispatch-web';
export const SECRET_ENV = 'OPENDISPATCH_KC_CLIENT_SECRET';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A password from an unambiguous alphabet. */
export function generatePassword(length = 20) {
  const out = [];
  while (out.length < length) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % ALPHABET.length)) out.push(ALPHABET[b % ALPHABET.length]);
  }
  return out.join('');
}

/** Realm users, each with its OpenDispatch role. */
export function demoUsers() {
  const realm = JSON.parse(fs.readFileSync(REALM_FILE, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'))
    .filter((r) => r.is_enabled)
    .sort((a, b) => a.priority - b.priority);
  return realm.users.map((u) => {
    const groups = (u.groups ?? []).map((g) => g.replace(/^\//, ''));
    const rule = rules.find((r) => groups.includes(r.group_match));
    return { id: u.id, username: u.username, email: u.email, groups, role: rule?.assigned_role ?? 'none' };
  });
}

export function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Keycloak on this machine, under /idp. */
export function localBase(state) {
  return `http://127.0.0.1:${state.OPENDISPATCH_KC_PORT}/idp`;
}

/** Where browsers reach Keycloak. */
export function frontBase(state) {
  return state.OPENDISPATCH_KC_PUBLIC_URL ? `${state.OPENDISPATCH_KC_PUBLIC_URL}/idp` : localBase(state);
}

/** Port, project and generated secrets. */
export function readState(dir) {
  const env = readEnvFile(path.join(dir, 'keycloak.env'));
  if (!env.OPENDISPATCH_KC_PORT) return null;
  return { ...env, issuer: `${frontBase(env)}/realms/${REALM}` };
}

export function saveState(dir, s) {
  const keys = ['OPENDISPATCH_KC_PORT', 'OPENDISPATCH_KC_PROJECT', 'OPENDISPATCH_KC_PUBLIC_URL', 'OPENDISPATCH_KC_BOOTSTRAP_PASSWORD', SECRET_ENV, 'OPENDISPATCH_KC_REDIRECTS'];
  writePrivate(path.join(dir, 'keycloak.env'), `${keys.map((k) => `${k}=${s[k] ?? ''}`).join('\n')}\n`);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding. */
export function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of text.replace(/=+$/, '')) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Users with an authenticator code too. */
export const needsAuthenticator = (username) => username.startsWith('mfa.');

/** username -> { password, totp }. */
export function readAccounts(dir) {
  const file = path.join(dir, 'logins.txt');
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [username, , password, totp] = line.trim().split(/\s+/);
    if (username && password && username !== 'username') out.set(username, { password, totp });
  }
  return out;
}

/** username -> password. */
export function readLogins(dir) {
  return new Map([...readAccounts(dir)].map(([u, a]) => [u, a.password]));
}

function writeLogins(dir, accounts, issuer) {
  const rows = demoUsers().map((u) => [u.username, u.role, accounts.get(u.username).password, accounts.get(u.username).totp ?? '']);
  const w = Math.max(...rows.map((r) => r[0].length)) + 2;
  const rw = Math.max(...rows.map((r) => r[1].length)) + 2;
  const pw = Math.max(...rows.map((r) => r[2].length)) + 2;
  const lines = [
    '# OpenDispatch sign-ins (Keycloak realm opendispatch, SYNTHETIC demo users). Keep private.',
    `# Login page: ${issuer ?? 'start Keycloak first'}  Reset: pnpm demo:logins --reset [username]`,
    '# mfa.demo also asks for a code: add its authenticator key to an authenticator app (TOTP, 6 digits, 30 s).',
    `${'username'.padEnd(w)}${'role'.padEnd(rw)}${'password'.padEnd(pw)}authenticator key`,
    ...rows.map(([u, r, p, t]) => `${u.padEnd(w)}${r.padEnd(rw)}${p.padEnd(pw)}${t}`.trimEnd()),
  ];
  writePrivate(path.join(dir, 'logins.txt'), `${lines.join('\n')}\n`);
}

/** A password (and key) for each user. */
export function ensureLogins(dir, reset, issuer) {
  const accounts = readAccounts(dir);
  for (const u of demoUsers()) {
    const renew = reset === true || reset === u.username;
    const prev = accounts.get(u.username);
    const next = { password: !prev || renew ? generatePassword() : prev.password, totp: prev?.totp };
    if (needsAuthenticator(u.username) && (!next.totp || renew)) next.totp = base32(Buffer.from(generatePassword(20)));
    accounts.set(u.username, next);
  }
  writeLogins(dir, accounts, issuer);
  return accounts;
}

/** The api's tenants file for this Keycloak. */
export function tenantsJson(state, web, tenantId) {
  return [
    {
      tenant_id: tenantId,
      issuer: state.issuer,
      client_id: CLIENT_ID,
      client_secret_env: SECRET_ENV,
      redirect_uri: `${web}/auth/callback`,
      install_mode: 'private',
      allow_insecure_http: state.issuer.startsWith('http://'),
    },
  ];
}
