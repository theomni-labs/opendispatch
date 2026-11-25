#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Dev Keycloak: docs/deploy/KEYCLOAK_DEV.md
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { CLIENT_ID, REALM, REALM_FILE, ROOT, SECRET_ENV, demoUsers, ensureLogins, frontBase, fromBase32, localBase, needsAuthenticator, readState, saveState, tenantsJson } from './state.mjs';

const COMPOSE = path.join(ROOT, 'deploy/dev/docker-compose.keycloak.yml');
const BOOTSTRAP_USER = 'opendispatch-bootstrap';
const DEFAULT_PORT = 8180;

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function compose(state, dir, ...args) {
  const env = {
    ...process.env,
    OPENDISPATCH_KC_PROJECT: state.OPENDISPATCH_KC_PROJECT,
    OPENDISPATCH_KC_PORT: state.OPENDISPATCH_KC_PORT,
    OPENDISPATCH_KC_BOOTSTRAP_PASSWORD: state.OPENDISPATCH_KC_BOOTSTRAP_PASSWORD,
    OPENDISPATCH_KC_HOSTNAME: frontBase(state),
    OPENDISPATCH_KC_HOSTNAME_ADMIN: localBase(state),
    OPENDISPATCH_KC_STATE_DIR: dir,
  };
  return spawnSync('docker', ['compose', '-f', COMPOSE, '-p', state.OPENDISPATCH_KC_PROJECT, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function running(state) {
  const out = execFileSync('docker', ['ps', '-q', '--filter', `label=com.docker.compose.project=${state.OPENDISPATCH_KC_PROJECT}`], { encoding: 'utf8' });
  return out.trim() !== '';
}

async function adminFetch(state, token, method, url, body) {
  const res = await fetch(`${localBase(state)}/admin/realms/${REALM}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`keycloak ${method} ${url}: ${String(res.status)}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

async function adminToken(state) {
  const form = new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: BOOTSTRAP_USER, password: state.OPENDISPATCH_KC_BOOTSTRAP_PASSWORD });
  const res = await fetch(`${localBase(state)}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`keycloak admin sign-in: ${String(res.status)}`);
  return (await res.json()).access_token;
}

/** amr names the password and the code. */
async function amrReferences(state, token) {
  const refs = { 'auth-username-password-form': 'pwd', 'auth-otp-form': 'otp' };
  const executions = await adminFetch(state, token, 'GET', '/authentication/flows/browser/executions');
  for (const e of executions) {
    const ref = refs[e.providerId];
    if (ref === undefined || e.authenticationConfig) continue;
    await adminFetch(state, token, 'POST', `/authentication/executions/${e.id}/config`, { alias: `opendispatch-amr-${ref}`, config: { 'default.reference.value': ref } });
  }
}

/** No account console roles by default. */
async function noAccountConsole(state, token) {
  const composites = await adminFetch(state, token, 'GET', `/roles/default-roles-${REALM}/composites`);
  const drop = composites.filter((r) => r.clientRole || r.name === 'offline_access');
  if (drop.length === 0) return;
  const role = await adminFetch(state, token, 'GET', `/roles/default-roles-${REALM}`);
  await adminFetch(state, token, 'DELETE', `/roles-by-id/${role.id}/composites`, drop);
}

/** Password and authenticator key in one import. */
async function withAuthenticator(state, token, u, account) {
  const rep = JSON.parse(fs.readFileSync(REALM_FILE, 'utf8')).users.find((x) => x.id === u.id);
  const credentials = [
    { type: 'password', value: account.password, temporary: false },
    {
      type: 'otp',
      userLabel: 'Demo authenticator',
      secretData: JSON.stringify({ value: fromBase32(account.totp).toString('utf8') }),
      credentialData: JSON.stringify({ subType: 'totp', digits: 6, counter: 0, period: 30, algorithm: 'HmacSHA1' }),
    },
  ];
  await adminFetch(state, token, 'POST', '/partialImport', { ifResourceExists: 'OVERWRITE', users: [{ ...rep, credentials }] });
}

/** Secret, redirects, passwords in. */
async function provision(state, logins, only) {
  const token = await adminToken(state);
  const [client] = await adminFetch(state, token, 'GET', `/clients?clientId=${CLIENT_ID}`);
  if (!client) throw new Error(`client ${CLIENT_ID} missing from the realm`);
  const bases = (state.OPENDISPATCH_KC_REDIRECTS ?? '').split(' ').filter(Boolean);
  client.secret = state[SECRET_ENV];
  client.redirectUris = [...new Set([...client.redirectUris, ...bases.map((b) => `${b}/auth/callback`)])];
  const logout = (client.attributes['post.logout.redirect.uris'] ?? '').split('##').filter(Boolean);
  client.attributes['post.logout.redirect.uris'] = [...new Set([...logout, ...bases.map((b) => `${b}/*`)])].join('##');
  await adminFetch(state, token, 'PUT', `/clients/${client.id}`, client);
  await amrReferences(state, token);
  await noAccountConsole(state, token);
  for (const u of demoUsers()) {
    if (only !== undefined && only !== u.username) continue;
    const account = logins.get(u.username);
    if (needsAuthenticator(u.username)) await withAuthenticator(state, token, u, account);
    else await adminFetch(state, token, 'PUT', `/users/${u.id}/reset-password`, { type: 'password', value: account.password, temporary: false });
  }
}

function parseArgs(argv) {
  const opts = { redirects: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--state') opts.state = next();
    else if (a === '--port') opts.port = next();
    else if (a === '--project') opts.project = next();
    else if (a === '--redirect') opts.redirects.push(next().replace(/\/+$/, ''));
    else if (a === '--web') opts.web = next().replace(/\/+$/, '');
    else if (a === '--public-url') opts.publicUrl = next().replace(/\/+$/, '');
    else if (a === '--out') opts.out = next();
    else if (a === '--demo') opts.demo = true;
    else if (a === '--reset') opts.reset = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
    else rest.push(a);
  }
  return { opts, rest };
}

function locate(opts) {
  if (opts.demo) {
    const dir = process.env.OPENDISPATCH_DEMO_DIR ?? path.join(ROOT, '.demo-state/demo');
    return { dir: path.resolve(dir), project: opts.project ?? `${process.env.OPENDISPATCH_DEMO_PG_NAME ?? 'opendispatch-demo-pg'}-keycloak` };
  }
  const dir = opts.state ?? process.env.OPENDISPATCH_KC_STATE_DIR ?? path.join(ROOT, '.demo-state/keycloak');
  return { dir: path.resolve(dir), project: opts.project ?? process.env.OPENDISPATCH_KC_PROJECT ?? 'opendispatch-keycloak-dev' };
}

function insideRepoAndNotIgnored(dir) {
  const rel = path.relative(ROOT, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', dir]).status !== 0;
}

async function up(opts) {
  const { dir, project } = locate(opts);
  if (insideRepoAndNotIgnored(dir)) throw new Error(`${dir} is inside the repository and not ignored: passwords must never be committable`);
  const prev = readState(dir) ?? {};
  const state = {
    OPENDISPATCH_KC_PORT: opts.port ?? prev.OPENDISPATCH_KC_PORT ?? String(DEFAULT_PORT),
    OPENDISPATCH_KC_PROJECT: project,
    OPENDISPATCH_KC_PUBLIC_URL: opts.publicUrl ?? '',
    OPENDISPATCH_KC_BOOTSTRAP_PASSWORD: prev.OPENDISPATCH_KC_BOOTSTRAP_PASSWORD || crypto.randomBytes(24).toString('hex'),
    [SECRET_ENV]: prev[SECRET_ENV] || crypto.randomBytes(32).toString('hex'),
    // the demo's web address replaces the last one
    OPENDISPATCH_KC_REDIRECTS: [...new Set([...(opts.demo && opts.redirects.length > 0 ? [] : (prev.OPENDISPATCH_KC_REDIRECTS ?? '').split(' ').filter(Boolean)), ...opts.redirects])].join(' '),
  };
  const mine = running(state);
  if (!mine && !(await portFree(Number(state.OPENDISPATCH_KC_PORT)))) throw new Error(`port ${state.OPENDISPATCH_KC_PORT} is taken: pass --port`);
  saveState(dir, state);
  if (state.OPENDISPATCH_KC_PUBLIC_URL && !state.OPENDISPATCH_KC_PUBLIC_URL.startsWith('https://')) throw new Error('--public-url must be https');
  const issuer = `${frontBase(state)}/realms/${REALM}`;
  const logins = ensureLogins(dir, opts.reset, issuer);
  const r = compose(state, dir, 'up', '-d', '--wait', '--force-recreate');
  if (r.status !== 0) throw new Error(`docker compose up failed:\n${r.stderr}`);
  await provision(state, logins);
  console.log(`keycloak: ${issuer} (project ${project}; listening on 127.0.0.1:${state.OPENDISPATCH_KC_PORT})`);
  console.log(`keycloak: sign-ins in ${path.join(dir, 'logins.txt')} (mode 600; never printed)`);
}

function down(opts) {
  const { dir, project } = locate(opts);
  const state = readState(dir) ?? { OPENDISPATCH_KC_PROJECT: project, OPENDISPATCH_KC_PORT: String(DEFAULT_PORT), OPENDISPATCH_KC_BOOTSTRAP_PASSWORD: 'unused' };
  state.OPENDISPATCH_KC_PROJECT = project;
  const r = compose(state, dir, 'down', '--remove-orphans');
  if (r.status !== 0) throw new Error(`docker compose down failed:\n${r.stderr}`);
  console.log(`keycloak: stopped (project ${project}; sign-ins kept in ${path.join(dir, 'logins.txt')})`);
}

async function logins(opts) {
  const { dir } = locate(opts);
  const state = readState(dir);
  const all = ensureLogins(dir, opts.reset, state?.issuer);
  if (opts.reset !== undefined && state !== null && running(state)) {
    await provision(state, all, opts.reset === true ? undefined : opts.reset);
    console.log('keycloak: new passwords set in the running Keycloak');
  }
  for (const u of demoUsers()) console.log(`  ${u.username.padEnd(18)}${u.role}`);
  console.log(`passwords: ${path.join(dir, 'logins.txt')}`);
}


function tenants(opts) {
  const { dir } = locate(opts);
  const state = readState(dir);
  if (state === null) throw new Error('no Keycloak state: run up first');
  if (!opts.web || !opts.out) throw new Error('tenants needs --web URL and --out FILE');
  const tenantId = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/manifest.json'), 'utf8')).tenant_id;
  fs.writeFileSync(opts.out, `${JSON.stringify(tenantsJson(state, opts.web, tenantId), null, 2)}\n`);
}

function status(opts) {
  const { dir } = locate(opts);
  const state = readState(dir);
  console.log(state === null ? 'keycloak: not set up' : `keycloak: ${state.issuer} ${running(state) ? 'running' : 'stopped'}`);
}

if (process.argv[1] === import.meta.filename) {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  const cmd = rest[0] ?? 'status';
  const run = { up, down, logins, tenants, status }[cmd];
  if (run === undefined) {
    console.error(`unknown command ${cmd} (up, down, logins, tenants, status)`);
    process.exit(2);
  }
  Promise.resolve(run(opts)).catch((err) => {
    console.error(`keycloak: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
