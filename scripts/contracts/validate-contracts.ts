// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Validates the contracts. Exits non-zero with a clear message per problem.
 *
 *   pnpm validate:contracts
 *
 * Checks
 *   1. redocly lint on contracts/openapi.yaml, contracts/feeds.openapi.yaml and contracts/platform/update-agent.yaml
 *      (config: contracts/redocly.yaml). Warnings fail too.
 *   2. Every engine schema compiles with ajv/dist/2020 + ajv-formats in strict mode; every
 *      component schema of the OpenAPI contract compiles the same way.
 *   3. Every $ref resolves (engine files, the bundled OpenAPI document, the bundled update agent).
 *   4. Every `examples` entry validates against its schema; engine examples also satisfy the
 *      invariants JSON Schema cannot express (invariants.ts).
 *   5. Contract self-tests: rules the data requires (parties_involved 0 and 1, assigned_at before
 *      registered_at, RULE-003A, reason code on manual changes, and so on).
 *   6. Operation rules: operationId, tags == x-module, x-required-access, approvals, a 4XX
 *      response, pagination on lists, no tenant / customer / role / context parameter, the
 *      module access matrix agrees with the role matrix, every flow's operations exist.
 *   7. The update agent stub: owned-by-the-host-platform header, five Updates tabs, required operations.
 *   8. Type-level check of the generated types: engine-types.test.ts (valid documents assign to
 *      every exported engine type, @ts-expect-error cases still error) compiled with tsc.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { checkEngineInvariants } from './invariants.js';
import {
  CONTRACTS_DIR,
  REPO_ROOT,
  UPDATE_AGENT_PATH,
  OPENAPI_PATH,
  bundleYaml,
  createAjv,
  getBundledOpenapi,
  getComponentSchema,
  getEngineSchema,
  listComponentSchemas,
  listEngineSchemas,
  type Json,
  type JsonObject,
} from './schemas.js';

const failures: string[] = [];
const notes: string[] = [];

function fail(section: string, message: string): void {
  failures.push(`[${section}] ${message}`);
}
function ok(message: string): void {
  console.log(`ok    ${message}`);
}
function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function obj(value: Json | undefined): JsonObject {
  return isObject(value) ? value : {};
}
function arr(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}
function str(value: Json | undefined): string {
  return typeof value === 'string' ? value : '';
}

// ---------------------------------------------------------------------------------------------
// 1. Lint
// ---------------------------------------------------------------------------------------------

function lint(file: string): void {
  const label = relative(REPO_ROOT, file);
  const cli = join(REPO_ROOT, 'node_modules', '@redocly', 'cli', 'bin', 'cli.js');
  let stdout = '';
  try {
    stdout = execFileSync(
      process.execPath,
      [cli, 'lint', file, '--config', join(CONTRACTS_DIR, 'redocly.yaml'), '--format', 'json'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true', CI: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).toString();
  } catch (error) {
    stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
  }
  const match = /^\{[\s\S]*?^\}/m.exec(stdout);
  if (!match) {
    fail('lint', `${label}: redocly produced no report. Output:\n${stdout.trim() || '(empty)'}`);
    return;
  }
  const report = JSON.parse(match[0]) as JsonObject;
  const totals = obj(report['totals']);
  const errors = Number(totals['errors'] ?? 0);
  const warnings = Number(totals['warnings'] ?? 0);
  for (const problem of arr(report['problems'])) {
    const p = obj(problem);
    const where = arr(p['location'])
      .map((l) => str(obj(l)['pointer']))
      .filter(Boolean)
      .join(', ');
    fail('lint', `${label}: ${str(p['severity'])} ${str(p['ruleId'])}: ${str(p['message'])} ${where}`.trim());
  }
  if (errors === 0 && warnings === 0) ok(`redocly lint ${label}: 0 errors, 0 warnings`);
}

// ---------------------------------------------------------------------------------------------
// 3. $ref resolution
// ---------------------------------------------------------------------------------------------

function resolvePointer(root: Json, pointer: string): Json | undefined {
  if (pointer === '' || pointer === '/') return root;
  let node: Json | undefined = root;
  for (const raw of pointer.replace(/^\//, '').split('/')) {
    const token = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) node = node[Number(token)];
    else if (isObject(node)) node = node[token];
    else return undefined;
  }
  return node;
}

function checkRefs(label: string, node: Json, root: Json, baseDir: string, path = ''): number {
  let count = 0;
  if (Array.isArray(node)) {
    node.forEach((item, i) => (count += checkRefs(label, item, root, baseDir, `${path}/${i}`)));
    return count;
  }
  if (!isObject(node)) return 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      count += 1;
      if (value.startsWith('#')) {
        if (resolvePointer(root, value.slice(1)) === undefined) fail('refs', `${label}: unresolved $ref ${value} at ${path || '/'}`);
      } else {
        const file = value.split('#')[0] ?? '';
        if (!existsSync(resolve(baseDir, file))) fail('refs', `${label}: $ref file not found: ${value} at ${path || '/'}`);
      }
    } else if (key !== 'examples' && key !== 'example' && key !== 'default' && key !== 'enum' && key !== 'const') {
      count += checkRefs(label, value, root, baseDir, `${path}/${key}`);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// 5. Self-tests
// ---------------------------------------------------------------------------------------------

const U = (n: number): string => `3f6f1b1e-7a55-4c27-9d0a-${String(n).padStart(12, '0')}`;
const base = (): Record<string, Json> => ({
  id: U(1),
  tenant_id: U(2),
  created_at: '2026-09-14T09:00:00+03:00',
  updated_at: '2026-09-14T09:00:00+03:00',
  created_by: null,
  data_source: 'SYNTHETIC',
});
const caseDoc = (over: Record<string, Json> = {}): Json => ({
  ...base(),
  external_id: 'NC-1',
  case_number: 'RD2609140001',
  registered_at: '2026-09-14T09:11:40+03:00',
  city_id: U(3),
  zone_id: U(4),
  sub_zone_id: U(5),
  latitude: 24.71,
  longitude: 46.68,
  case_type_id: U(6),
  parties_involved: 2,
  assigned_at: '2026-09-14T09:14:00+03:00',
  arrived_at: '2026-09-14T09:24:00+03:00',
  closed_at: '2026-09-14T09:35:00+03:00',
  handling: 'field',
  ...over,
});
const assignmentDoc = (over: Record<string, Json> = {}): Json => ({
  ...base(),
  case_id: U(7),
  agent_id: U(8),
  decided_at: '2026-09-14T09:14:00+03:00',
  source: 'OPENDISPATCH',
  stage: 'automatic',
  state: 'assigned',
  reason_code: null,
  estimated_arrival_at: '2026-09-14T09:21:00+03:00',
  estimated_travel_seconds: 420,
  ...over,
});
const overrideDoc = (over: Record<string, Json> = {}): Json => ({
  ...base(),
  roster_id: U(9),
  change_type: 'replace_agent',
  reason_code: 'agent_unavailable',
  status: 'pending',
  ...over,
});

interface SelfTest {
  schema: string;
  label: string;
  valid: boolean;
  doc: Json;
}

const SELF_TESTS: SelfTest[] = [
  { schema: 'Case', label: 'a normal field case', valid: true, doc: caseDoc() },
  { schema: 'Case', label: 'parties_involved 0 is allowed', valid: true, doc: caseDoc({ parties_involved: 0 }) },
  { schema: 'Case', label: 'parties_involved 1 is allowed', valid: true, doc: caseDoc({ parties_involved: 1 }) },
  {
    schema: 'Case',
    label: 'assigned_at earlier than registered_at is allowed',
    valid: true,
    doc: caseDoc({ assigned_at: '2026-09-14T09:05:00+03:00' }),
  },
  {
    schema: 'Case',
    label: 'a remote case with no assigned_at',
    valid: true,
    doc: caseDoc({ handling: 'remote_inferred', assigned_at: null, arrived_at: null }),
  },
  { schema: 'Case', label: 'handling "remote" is not a valid value', valid: false, doc: caseDoc({ handling: 'remote' }) },
  { schema: 'Case', label: 'negative parties_involved is refused', valid: false, doc: caseDoc({ parties_involved: -1 }) },
  { schema: 'Case', label: 'an unknown property is refused', valid: false, doc: caseDoc({ tenant: 'x' }) },
  { schema: 'RuleCode', label: 'RULE-003A', valid: true, doc: 'RULE-003A' },
  { schema: 'RuleCode', label: 'RULE-001', valid: true, doc: 'RULE-001' },
  { schema: 'RuleCode', label: 'RULE-3 (too short)', valid: false, doc: 'RULE-3' },
  { schema: 'RuleCode', label: 'RULE-003AB (two letters)', valid: false, doc: 'RULE-003AB' },
  { schema: 'RuleCode', label: 'lower case', valid: false, doc: 'rule-003' },
  { schema: 'Assignment', label: 'OpenDispatch assignment without reason code', valid: true, doc: assignmentDoc() },
  {
    schema: 'Assignment',
    label: 'MANUAL assignment with a reason code',
    valid: true,
    doc: assignmentDoc({ source: 'MANUAL', reason_code: 'closer_agent_known' }),
  },
  { schema: 'Assignment', label: 'MANUAL assignment needs a reason code', valid: false, doc: assignmentDoc({ source: 'MANUAL' }) },
  { schema: 'Override', label: 'override with a coded reason', valid: true, doc: overrideDoc() },
  { schema: 'Override', label: 'reason other needs a note', valid: false, doc: overrideDoc({ reason_code: 'other' }) },
  { schema: 'Override', label: 'reason other with a note', valid: true, doc: overrideDoc({ reason_code: 'other', note: 'Road closed.' }) },
  { schema: 'OverrideCreate', label: 'override request needs a reason code', valid: false, doc: { change_type: 'replace_agent' } },
  {
    schema: 'OverrideCreate',
    label: 'override request with a reason code',
    valid: true,
    doc: { change_type: 'replace_agent', reason_code: 'skills_needed', agent_id: U(10) },
  },
  { schema: 'OverrideCreate', label: 'made-up reason code is refused', valid: false, doc: { change_type: 'add_assignment', reason_code: 'because' } },
  { schema: 'ClockStartUpdate', label: 'clock start assignment', valid: true, doc: { clock_start: 'assignment' } },
  { schema: 'ClockStartUpdate', label: 'clock start registration', valid: true, doc: { clock_start: 'registration' } },
  { schema: 'ClockStartUpdate', label: 'clock start dispatch is refused', valid: false, doc: { clock_start: 'dispatch' } },
  { schema: 'ZoneStageUpdate', label: 'stage automatic', valid: true, doc: { stage: 'automatic' } },
  { schema: 'ZoneStageUpdate', label: 'stage live is refused', valid: false, doc: { stage: 'live' } },
  { schema: 'UserCreate', label: 'a user with a role and two zones', valid: true, doc: { email: 'planner@example.com', display_name: 'Test Planner', assigned_role: 'planner', zone_ids: [U(4), U(11)] } },
  { schema: 'UserCreate', label: 'a request that tries to send a role parameter', valid: false, doc: { email: 'planner@example.com', display_name: 'Test Planner', role: 'planner' } },
];

function runSelfTests(): void {
  let passed = 0;
  for (const test of SELF_TESTS) {
    try {
      const validate = createAjv().compile(getComponentSchema(test.schema));
      const result = validate(test.doc) === true;
      if (result === test.valid) passed += 1;
      else {
        const detail = result ? '' : ` (${JSON.stringify(validate.errors?.slice(0, 2))})`;
        fail('self-test', `${test.schema}: ${test.label}: expected ${test.valid ? 'valid' : 'invalid'}${detail}`);
      }
    } catch (error) {
      fail('self-test', `${test.schema}: ${test.label}: ${(error as Error).message}`);
    }
  }
  if (passed === SELF_TESTS.length) ok(`contract self-tests: ${passed} of ${SELF_TESTS.length} pass`);
}

// ---------------------------------------------------------------------------------------------
// 2 and 4. Schemas and examples
// ---------------------------------------------------------------------------------------------

function checkEngines(): void {
  const names = listEngineSchemas();
  let examples = 0;
  for (const name of names) {
    const schema = getEngineSchema(name) as JsonObject;
    for (const key of ['$schema', '$id', 'title', 'description', 'examples']) {
      if (schema[key] === undefined) fail('engines', `${name}: missing ${key}`);
    }
    if (schema['additionalProperties'] !== false) fail('engines', `${name}: root additionalProperties must be false (deliberate decision)`);
    if (schema['$id'] !== `https://opendispatch.example/contracts/engines/${name}.schema.json`) fail('engines', `${name}: $id does not match the file name`);
    let validate;
    try {
      validate = createAjv().compile(schema);
    } catch (error) {
      fail('engines', `${name}: does not compile in strict mode: ${(error as Error).message}`);
      continue;
    }
    checkRefs(name, schema, schema, dirname(join(CONTRACTS_DIR, 'engines', name)));
    const list = arr(schema['examples']);
    if (list.length === 0) fail('engines', `${name}: needs at least one example`);
    list.forEach((example, i) => {
      examples += 1;
      if (validate(example) !== true) {
        fail('engines', `${name}: examples[${i}] does not validate: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
      }
      for (const problem of checkEngineInvariants(name, example)) fail('engines', `${name}: examples[${i}]: ${problem}`);
    });
  }
  const expected = ['assignment', 'forecaster', 'optimizer', 'simulator'].flatMap((e) => [`${e}.input`, `${e}.output`]);
  for (const e of expected) if (!names.includes(e)) fail('engines', `missing engine schema ${e}`);
  ok(`engine schemas: ${names.length} compile in strict mode, ${examples} examples valid with invariants`);
}

function checkComponents(): void {
  const names = listComponentSchemas();
  let compiled = 0;
  let examples = 0;
  for (const name of names) {
    let schema: JsonObject;
    try {
      schema = getComponentSchema(name) as JsonObject;
    } catch (error) {
      fail('components', `${name}: ${(error as Error).message}`);
      continue;
    }
    let validate;
    try {
      validate = createAjv().compile(schema);
      compiled += 1;
    } catch (error) {
      fail('components', `${name}: does not compile in strict mode: ${(error as Error).message}`);
      continue;
    }
    for (const [i, example] of arr(schema['examples']).entries()) {
      examples += 1;
      if (validate(example) !== true) fail('components', `${name}: examples[${i}] does not validate: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
    }
  }
  ok(`openapi component schemas: ${compiled} of ${names.length} compile in strict mode, ${examples} examples valid`);
}

// ---------------------------------------------------------------------------------------------
// 6. Operations
// ---------------------------------------------------------------------------------------------

const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const FORBIDDEN_PARAMS = new Set(['tenant', 'tenant_id', 'tenantid', 'customer', 'customer_id', 'customerid', 'role', 'role_id', 'context', 'x-tenant-id', 'x-customer-id', 'x-role', 'x-context']);
const FORBIDDEN_BODY_PROPS = new Set(['tenant', 'tenant_id', 'customer', 'customer_id', 'role', 'context', 'request_context']);
const ROLES = ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'];
const PUBLIC_OPERATIONS = ['demoSignIn', 'emergencyAdminSignIn', 'getDemoOptions', 'getLiveness', 'getReadiness', 'mockSignIn'];
/** POST operations that need only `view`: a preview that changes nothing, the pre-session sign-in, and a request a view-only role may make (asking for a change it may not make itself). */
const READ_ONLY_POSTS = ['previewRoleMappings', 'emergencyAdminSignIn', 'requestIdentityProviderChange', 'explainWithAssistant', 'askAssistant', 'summariseShiftHandover', 'summariseMyAlerts', 'explainImportIssuesWithAssistant', 'suggestCaseClassification'];

/** the role matrix: modules visible to each role (Ops numbers, Admin numbers) and the ones it edits. */
const APPENDIX_C: Record<string, { ops: number[]; admin: number[]; editOps: number[]; editAdmin: number[] }> = {
  administrator: { ops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], editOps: [], editAdmin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18] },
  dispatch_supervisor: { ops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], admin: [5], editOps: [2, 4], editAdmin: [] },
  dispatcher: { ops: [1, 2, 5], admin: [], editOps: [2], editAdmin: [] },
  planner: { ops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], admin: [], editOps: [4, 5, 6, 7, 8, 9, 10, 11], editAdmin: [] },
  remote_team_lead: { ops: [1, 3, 6, 11], admin: [], editOps: [3], editAdmin: [] },
  viewer_auditor: { ops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], admin: [11, 18], editOps: [], editAdmin: [] },
  change_approver: { ops: [], admin: [11, 16], editOps: [], editAdmin: [] },
};

const FLOW_OPERATIONS: Record<string, string[]> = {
  'flow 1 rule change': ['createRule', 'createRuleVersionDraft', 'updateRuleVersionDraft', 'submitRuleVersion', 'approveRuleVersion', 'rejectRuleVersion', 'retireRule', 'getForecastSplit', 'listAuditEvents'],
  'flow 2 roster': ['buildRoster', 'listRosterAssignments', 'getGapSurplus', 'createOverride', 'approveOverride', 'rejectOverride', 'submitRoster', 'approveRoster', 'rejectRoster', 'publishRoster'],
  'flow 3 leave': ['listLeaveRequests', 'getLeaveCoverageEffect', 'approveLeaveRequest', 'declineLeaveRequest', 'listLeaveWindows'],
  'flow 4 scenario': ['createScenario', 'updateScenario', 'runScenario', 'getGapSurplus'],
  'flow 5 import': ['uploadImport', 'validateImport', 'listImportIssues', 'compareImport', 'dryRunCutover', 'executeCutover'],
  'flow 6 user and role': ['createUser', 'updateUser', 'getEffectiveAccess', 'createRoleMapping'],
  'flow 7 model admin': ['listModelVersions', 'switchModelVersion', 'pauseModel', 'resumeModel', 'listMyNotifications'],
  'flow 8 sign-in and SSO': ['listIdentityProviderPresets', 'createIdentityProvider', 'updateIdentityProvider', 'testIdentityProviderConnection', 'createRoleMapping', 'previewRoleMappings', 'mockSignIn', 'emergencyAdminSignIn', 'getSignInPolicy', 'updateSignInPolicy'],
  'flow 9 updates (api side)': ['getUpdatesSummary', 'getUpdateStatus', 'scheduleUpdate', 'approveUpdate', 'applyUpdate', 'requestUpdateRecovery', 'uploadOfflineUpdate', 'updateUpdateConnection', 'updateUpdateChangeWindows'],
  'flow 11 live dispatch': ['getLiveBoard', 'getCaseRecommendation', 'acceptRecommendation', 'overrideAssignment', 'listZoneStages', 'setZoneStage', 'getFallbackState', 'sendFallbackSignal', 'listShadowComparisons', 'getShadowComparisonSummary', 'getReplayState', 'controlReplay', 'simulateFeedOutage'],
  'settings, health, admin areas': ['getSettingsSnapshot', 'updateClockStart', 'updatePlanningLevel', 'updateLiveAssignmentSettings', 'getIntegrationsHealth', 'getSystemHealth', 'listAuditEvents', 'listMyNotifications', 'listNotificationRules', 'listApiClients', 'listWebhooks', 'getSessionPolicy', 'listControlEvidence', 'getLocalizationSettings', 'listDashboardRollups', 'listProductivityRollups', 'resetDemoData'],
};

interface Operation {
  method: string;
  path: string;
  op: JsonObject;
}

/** Top-level property names of a bundled component schema, following $ref and allOf. */
function topLevelProperties(name: string): string[] {
  const components = obj(obj(getBundledOpenapi()['components'])['schemas']);
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (node: Json | undefined): void => {
    if (!isObject(node)) return;
    const ref = str(node['$ref']);
    if (ref) {
      const target = ref.split('/').pop() ?? '';
      if (!seen.has(target)) {
        seen.add(target);
        visit(components[target]);
      }
    }
    for (const key of Object.keys(obj(node['properties']))) names.add(key);
    for (const part of arr(node['allOf'])) visit(part);
  };
  visit(components[name]);
  return [...names];
}

function checkOperations(): { operations: Operation[]; moduleCount: number } {
  const doc = getBundledOpenapi();
  const paths = doc.paths;
  const params = obj(obj(doc['components'])['parameters']);
  const tags = new Set(arr(doc['tags']).map((t) => str(obj(t)['name'])));
  const modules = arr(doc['x-modules']).map((m) => obj(m));
  const moduleById = new Map(modules.map((m) => [str(m['id']), m]));
  const operations: Operation[] = [];

  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = obj(obj(item)[method]);
      if (Object.keys(op).length > 0) operations.push({ method, path, op });
    }
  }

  const ids = new Set<string>();
  const perModule = new Map<string, number>();
  for (const { method, path, op } of operations) {
    const where = `${method.toUpperCase()} ${path}`;
    const id = str(op['operationId']);
    if (!id) fail('operations', `${where}: missing operationId`);
    else if (ids.has(id)) fail('operations', `${where}: duplicate operationId ${id}`);
    ids.add(id);

    const moduleId = str(op['x-module']);
    const mod = moduleById.get(moduleId);
    if (!mod) fail('operations', `${where}: x-module "${moduleId}" is not in x-modules`);
    perModule.set(moduleId, (perModule.get(moduleId) ?? 0) + 1);
    const opTags = arr(op['tags']).map(str);
    if (opTags.length !== 1 || opTags[0] !== moduleId) fail('operations', `${where}: tags must be exactly [${moduleId}]`);
    if (!tags.has(moduleId)) fail('operations', `${where}: tag ${moduleId} is not declared at the root`);
    if (!str(op['summary'])) fail('operations', `${where}: missing summary`);

    const access = str(op['x-required-access']);
    if (access !== 'view' && access !== 'edit') fail('operations', `${where}: x-required-access must be view or edit`);
    if (access === 'view' && method !== 'get' && !(method === 'post' && READ_ONLY_POSTS.includes(id))) {
      fail('operations', `${where}: a ${method.toUpperCase()} operation must not be view-only`);
    }
    if (op['x-approval'] === true) {
      if (access !== 'edit') fail('operations', `${where}: approval operations use x-required-access edit`);
      if (mod && arr(mod['approvers']).length === 0) fail('operations', `${where}: module ${moduleId} has no approvers`);
    } else if (mod && access === 'edit' && !ROLES.some((r) => obj(mod['access'])[r] === 'edit')) {
      fail('operations', `${where}: no role has edit access to ${moduleId}`);
    }

    const responses = obj(op['responses']);
    if (!Object.keys(responses).some((c) => /^2/.test(c))) fail('operations', `${where}: no 2xx response`);
    if (responses['4XX'] === undefined) fail('operations', `${where}: no 4XX response`);
    const security = op['security'];
    const isPublic = Array.isArray(security) && security.length === 0;
    if (isPublic !== PUBLIC_OPERATIONS.includes(id)) fail('operations', `${where}: security override does not match the public operation list`);

    const resolved: JsonObject[] = arr(op['parameters']).map((p) => {
      const ref = str(obj(p)['$ref']);
      const name = ref.split('/').pop() ?? '';
      return ref ? { ...obj(params[name]), $refName: name } : obj(p);
    });
    for (const p of resolved) {
      if (FORBIDDEN_PARAMS.has(str(p['name']).toLowerCase())) fail('operations', `${where}: parameter "${str(p['name'])}" must not exist (context comes from the server)`);
    }
    const pathNames = [...path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] ?? '');
    for (const name of pathNames) {
      if (!resolved.some((p) => p['in'] === 'path' && p['name'] === name)) fail('operations', `${where}: path parameter {${name}} is not defined`);
    }

    const body = obj(obj(op['requestBody'])['content']);
    for (const media of Object.values(body)) {
      const ref = str(obj(obj(media)['schema'])['$ref']);
      const name = ref.split('/').pop() ?? '';
      if (!name) continue;
      for (const prop of topLevelProperties(name)) {
        if (FORBIDDEN_BODY_PROPS.has(prop)) fail('operations', `${where}: request body ${name} has forbidden property "${prop}"`);
      }
    }

    const okContent = obj(obj(responses['200'])['content']);
    const okRef = str(obj(obj(okContent['application/json'])['schema'])['$ref']);
    if (method === 'get' && okRef.endsWith('List') && !okRef.includes('.')) {
      const names = resolved.map((p) => str(p['name']));
      if (!names.includes('limit') || !names.includes('cursor')) fail('operations', `${where}: list response ${okRef.split('/').pop()} needs limit and cursor parameters`);
    }
  }

  for (const [flow, list] of Object.entries(FLOW_OPERATIONS)) {
    for (const id of list) if (!ids.has(id)) fail('flows', `${flow}: operation ${id} is missing`);
  }
  const reset = operations.find((o) => o.path === '/demo/reset' && o.method === 'post');
  if (!reset) fail('operations', 'POST /demo/reset is missing');
  else if (reset.op['x-demo-only'] !== true || !str(reset.op['description']).includes('DEMO ONLY')) fail('operations', 'POST /demo/reset must be documented as demo-only');

  // 30 modules, every one with operations
  const ops = modules.filter((m) => m['console'] === 'ops');
  const admin = modules.filter((m) => m['console'] === 'admin');
  if (ops.length !== 12) fail('modules', `expected 12 Ops modules, found ${ops.length}`);
  if (admin.length !== 18) fail('modules', `expected 18 Admin modules, found ${admin.length}`);
  for (const m of modules) if (!perModule.get(str(m['id']))) fail('modules', `module ${str(m['id'])} has no operations`);

  // the role matrix
  const byNumber = (console: string, n: number): JsonObject | undefined => modules.find((m) => m['console'] === console && m['number'] === n);
  for (const [role, expected] of Object.entries(APPENDIX_C)) {
    for (const [console, wantVisible, wantEdit] of [['ops', expected.ops, expected.editOps], ['admin', expected.admin, expected.editAdmin]] as const) {
      const visible: number[] = [];
      const edit: number[] = [];
      for (const m of modules.filter((x) => x['console'] === console)) {
        const level = str(obj(m['access'])[role]);
        const approver = arr(m['approvers']).map(str).includes(role);
        if (level !== 'none' || approver) visible.push(Number(m['number']));
        if (level === 'edit') edit.push(Number(m['number']));
      }
      if (JSON.stringify(visible) !== JSON.stringify(wantVisible)) fail('appendix-c', `${role} ${console} modules: got ${visible.join(',')}, plan says ${wantVisible.join(',')}`);
      if (JSON.stringify(edit) !== JSON.stringify(wantEdit)) fail('appendix-c', `${role} ${console} edit: got ${edit.join(',')}, plan says ${wantEdit.join(',')}`);
    }
  }
  const approvers = (console: string, n: number): string => arr(byNumber(console, n)?.['approvers']).map(str).join(',');
  if (approvers('admin', 5) !== 'dispatch_supervisor') fail('appendix-c', 'Classification Rules approver must be dispatch_supervisor');
  if (approvers('admin', 16) !== 'change_approver') fail('appendix-c', 'Updates approver must be change_approver');
  if (approvers('ops', 4) !== 'dispatch_supervisor') fail('appendix-c', 'Field Planner Workbench approver must be dispatch_supervisor');

  // Persisted records: BaseRecord + closed
  let records = 0;
  for (const name of listComponentSchemas()) {
    const raw = obj(obj(obj(doc['components'])['schemas'])[name]);
    const usesBase = arr(raw['allOf']).some((p) => str(obj(p)['$ref']) === '#/components/schemas/BaseRecord');
    if (usesBase) {
      records += 1;
      if (raw['unevaluatedProperties'] !== false) fail('records', `${name}: persisted record must set unevaluatedProperties: false`);
    }
    if (obj(raw['properties'])['tenant_id'] !== undefined && name !== 'BaseRecord') fail('records', `${name}: declares tenant_id itself; it comes from BaseRecord`);
  }
  const baseProps = Object.keys(obj(obj(obj(obj(doc['components'])['schemas'])['BaseRecord'])['properties']));
  for (const need of ['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'data_source']) {
    if (!baseProps.includes(need)) fail('records', `BaseRecord is missing ${need}`);
  }
  notes.push(`${records} persisted record schemas share BaseRecord`);

  ok(`operations: ${operations.length} operations on ${Object.keys(paths).length} paths, ${modules.length} modules (12 Ops, 18 Admin, ${modules.length - 30} shared)`);
  return { operations, moduleCount: modules.length };
}

// ---------------------------------------------------------------------------------------------
// 7. Update agent stub
// ---------------------------------------------------------------------------------------------

function checkUpdateAgent(): void {
  const dir = mkdtempSync(join(tmpdir(), 'opendispatch-ua-'));
  try {
    const out = join(dir, 'update-agent.json');
    bundleYaml(UPDATE_AGENT_PATH, out);
    const doc = JSON.parse(readFileSync(out, 'utf8')) as JsonObject;
    checkRefs('update-agent.yaml', doc, doc, CONTRACTS_DIR);
    const info = obj(doc['info']);
    if (!str(info['description']).includes('OWNED BY THE HOST PLATFORM')) fail('update-agent', 'info.description must state that the contract is OWNED BY THE HOST PLATFORM');
    if (info['x-owner'] !== 'host-platform' || doc['x-owner'] !== 'host-platform') fail('update-agent', 'x-owner must be host-platform (info and root)');
    const tabs = arr(doc['tags']).map((t) => str(obj(t)['x-tab'])).sort();
    if (JSON.stringify(tabs) !== JSON.stringify(['change-windows', 'connection', 'history', 'overview', 'settings'])) fail('update-agent', `the five Updates tabs are not all covered: ${tabs.join(',')}`);
    const ids = new Set<string>();
    for (const item of Object.values(obj(doc['paths']))) for (const m of METHODS) { const id = str(obj(obj(item)[m])['operationId']); if (id) ids.add(id); }
    const required = ['getUpdateStatus', 'listReleases', 'getRelease', 'checkForUpdatesNow', 'getDownloadState', 'startDownload', 'getPreflight', 'runPreflight', 'scheduleUpdate', 'approveUpdate', 'rejectUpdate', 'applyUpdate', 'skipRelease', 'requestRecovery', 'requestEmergencyOverride', 'listUpdateHistory', 'getUpdateSettings', 'updateUpdateSettings', 'getConnection', 'updateConnection', 'testConnection', 'uploadOfflineFile', 'getOfflineUpload', 'getChangeWindows', 'updateChangeWindows', 'getNextChangeWindow', 'getChangePolicy', 'updateChangePolicy', 'getApplyRun', 'confirmBackupForRelease'];
    for (const id of required) if (!ids.has(id)) fail('update-agent', `operation ${id} is missing`);
    const emergency = obj(obj(obj(doc['components'])['schemas'])['EmergencyOverrideRequest']);
    if (obj(obj(emergency['properties'])['approvers'])['minItems'] !== 2) fail('update-agent', 'emergency override must require two approvers');
    ok(`update agent stub: ${ids.size} operations, five tabs, owned by the host platform`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// 8. Type-level check of the generated types
// ---------------------------------------------------------------------------------------------

function checkGeneratedTypes(): void {
  const tsc = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const project = join(REPO_ROOT, 'scripts', 'contracts', 'tsconfig.types.json');
  if (!existsSync(join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'types', 'index.ts'))) {
    fail('types', 'apps/web/src/lib/types/index.ts is missing. Run: pnpm generate:types');
    return;
  }
  try {
    execFileSync(process.execPath, [tsc, '-p', project, '--noEmit', '--pretty', 'false'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ok('generated types: engine-types.test.ts compiles (valid documents assign, negative cases error)');
  } catch (error) {
    const out = (error as { stdout?: Buffer }).stdout?.toString().trim() ?? '';
    fail('types', `type check of the generated types failed. Run pnpm generate:types, then:\n${out.split('\n').slice(0, 12).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------------------------

function main(): void {
  lint(OPENAPI_PATH);
  lint(UPDATE_AGENT_PATH);
  lint(join(CONTRACTS_DIR, 'feeds.openapi.yaml'));
  checkEngines();
  checkComponents();
  const doc = getBundledOpenapi();
  const refs = checkRefs('openapi.yaml (bundled)', doc, doc, CONTRACTS_DIR);
  ok(`$refs: ${refs} references in the bundled openapi.yaml resolve`);
  runSelfTests();
  checkOperations();
  checkUpdateAgent();
  checkGeneratedTypes();

  for (const note of notes) console.log(`note  ${note}`);
  if (failures.length > 0) {
    console.error(`\nvalidate-contracts: ${failures.length} problem${failures.length === 1 ? '' : 's'}`);
    for (const f of failures) console.error(`  FAIL ${f}`);
    process.exit(1);
  }
  console.log('\nvalidate-contracts: all checks pass');
}

main();
