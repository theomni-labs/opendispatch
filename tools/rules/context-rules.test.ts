// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getBundledOpenapi } from '../../scripts/contracts/schemas';

// Static guard for the project rules, 21 and 25. It reads the source with the TypeScript parser, so it holds
// for code nobody has run yet.
//
// lib/data (review findings M2 and m1). Every exported function of a public module of apps/web/src/lib/data is exactly one of:
//   - an OPERATION: a contract operationId (or, for a few screen-facing reads and writes the contract lacks, a function marked
//     `// operationId: (not in the contract) name` AND listed in NON_CONTRACT_OPERATIONS with a reason). It is marked with
//     `// operationId: name`, takes `ctx: RequestContext` first, and reaches a guard (requireAccess, requirePlatform,
//     checkApproval, or writeWithAudit with a real guard) directly, or through a delegate listed in GUARD_DELEGATES, which
//     the test checks really guards;
//   - tagged `@pure` in its JSDoc: it reads nothing from./internal/ (checked at function level, through the helpers of the
//     same file it calls);
//   - a guard itself (GUARD_FUNCTIONS) or in CONTEXT_FREE (how a context is built, small pure helpers).
// Anything else is not exported: it lives in a file under lib/data/internal/, which the ESLint ban keeps screens out of.
//
// The ONE exception to "ctx: RequestContext first" (mockSignIn and emergencyAdminSignIn run
// before anyone has signed in, so they take a PreSessionContext (customer and install mode, no role, no user). They are named in
// PRE_SESSION_OPERATIONS with the reason, they must reach requirePreSession, no other function may take that type, and neither
// reads a role, user or zone scope from its input.
//
// Server actions and route handlers: no parameter, destructured field or field of a parameter's type may be named
// like a context, customer, tenant, user or role, except the one sanctioned demo action.

const root = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = path.join(root, 'apps/web/src/lib/data');
const appSrc = path.join(root, 'apps/web/src');

/** Exported functions in lib/data that legitimately have no context: pure helpers, and how a context is built. */
const CONTEXT_FREE = new Set([
  'getRequestContext',
  'requireRequestContext',
  'getPreSessionContext',
  'getDemoOptions',
  'emergencyViaGo',
  'logoutViaGo',
  'demoSignIn',
  'sessionOfSignIn',
  'proxyAuth',
  'sendImportUploadChunk', // browser to this site's route
  'toRiyadhIso',
  'nowIso',
  'epochOf',
  'dateOf',
  'deterministicUuid',
  'requireFound',
  'defined',
  'customerShortName', // install setting, read by i18n
  'isNeutralWording',
  'neutralCaseTypeName',
  'neutralText',
  'caseTypeName', // install setting
  'customerText', // install setting
]);

/** Calls that count as a guard. `writeWithAudit` counts only with a real guard as its second argument. */
const GUARD_CALLS = new Set(['requireAccess', 'requirePlatform', 'checkApproval', 'writeWithAudit', 'writeWithAuditAsync']);
// businessFetch: Go guards and audits (step 5)
const OPERATION_GUARD_CALLS: ReadonlySet<string> = new Set([...GUARD_CALLS, 'businessFetch']);
/** writeWithAudit and its async twin: same (ctx, guard,...) shape. */
const isWriteWithAudit = (name: string): boolean => name === 'writeWithAudit' || name === 'writeWithAuditAsync';

/** The guards themselves, exported by the file that defines them. */
const GUARD_FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
  'guard.ts': ['requireAccess'],
  'context.ts': ['requirePlatform', 'requirePreSession'],
};

/** The guard of the pre-session operations. It is not in GUARD_CALLS: a RequestContext operation cannot pass with it. */
const PRE_SESSION_GUARD_CALLS = new Set(['requirePreSession']);

/**
 * The only operations that take a PreSessionContext instead of `ctx: RequestContext`, each with the reason. They
 * run before anyone has signed in, so there is no role and no user to put in a context, and a made-up role would be a default
 * role in all but name.
 */
const PRE_SESSION_OPERATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'identity.ts': {
    mockSignIn: 'Sign-in through the labelled mock provider: the visitor has no session yet (customer and install mode only).',
    emergencyAdminSignIn: 'Sign-in of the local emergency administrator: the visitor has no session yet (customer and install mode only).',
  },
};

/**
 * The other functions allowed to mention PreSessionContext in a parameter type. `requirePreSession` is the guard. Under internal/ (never importable by a screen): the alert raiser is
 * called from the two sign-in operations.
 */
const PRE_SESSION_HELPERS: Readonly<Record<string, readonly string[]>> = {
  'context.ts': ['requirePreSession'],
  'internal/business-client.ts': ['preSessionPost'],
};

/** The only fields of a PreSessionContext an operation may read. */
const PRE_SESSION_FIELDS = new Set(['customerId', 'installMode']);

/**
 * Operations that are not in contracts/openapi.yaml but are called by a screen or a shell, each with the reason. A new one
 * needs an entry here, which is the review.
 */
const NON_CONTRACT_OPERATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'standby.ts': {
    recommendStandbyMoves: 'Standby Coverage Map: the "suggest moves" action (contract has no operation for it yet).',
    applyStandbyMove: 'Standby Coverage Map: applies one suggested move to a draft roster (audited write).',
  },
  'notifications.ts': { countUnreadNotifications: 'The number on the AppShell bell (ConsoleShell.tsx); guarded by platform.session.' },
  'remote.ts': { getRemoteQueueClock: 'Remote Queue and Scheduling: the "as of" clock, since Remote Team Lead has no access to ops.live_dispatch_board (getReplayState); guarded by ops.remote_queue view.' },
  'locations.ts': { getLocationsImportSample: 'The "Use a sample file" link of the Locations import dialog (a screen may not read fixtures); guarded by admin.locations view.' },
  'people.ts': { getAgentsImportSample: 'The sample file of the Agents import dialog (a screen may not read fixtures); guarded by admin.agents_vehicles view.' },
  'settings.ts': {
    listSettings: 'Raw settings list of Admin 9 (Data Sources); guarded by admin.data_sources view.',
    getOverrideReasonCodes: 'Override reason vocabulary for the override dialogs; guarded by platform.session.',
    getSkillVocabulary: 'Skills vocabulary for the agent screens; guarded by platform.session.',
    getDemoToday: 'Demo tooling: the Field Planner Workbench and Forecast Explorer default a zone and a day near it; guarded by platform.session.',
  },
  'users.ts': { previewEffectiveAccess: 'The Add user form previews the access of a role that is not saved yet; guarded by admin.users_roles view.' },
  'simulation.ts': { getSimulationHistoryRange: 'Service-Level Simulator: the days the committed case history covers, for the "Cases of" picker; guarded by ops.service_level_simulator view.' },
  'leave.ts': {
    getLeaveCoverageEffects:
      'Leave Planner: batch form of getLeaveCoverageEffect, one shared loadPlan() instead of one per row; guarded by ops.leave_planner view.',
  },
  'cases.ts': {
    listAllCases:
      'Live Dispatch Board, Productivity and Metrics, Management Dashboards: the unpaginated form listCases callers must use instead of walking listCases in a loop (the listCases N+1 fix); guarded by platform.records.',
  },
};

/**
 * Writes guarded by Go alone (step 5): the call goes straight to Go, which checks the role first and audits a denial. Each
 * entry names the Go function that guards it. The test checks the operation calls Go and validates nothing before it.
 */
const GO_GUARDED_WRITES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'dispatch.ts': {
    acceptRecommendation: 'business/dispatch.go AcceptRecommendation: WriteWithAudit, edit on ops.live_dispatch_board, then the zone',
    overrideAssignment: 'business/dispatch.go OverrideAssignment: WriteWithAudit, edit on ops.live_dispatch_board, then the zone',
    controlReplay: 'business/dispatch.go ControlReplay: GuardWithAudit, edit on ops.live_dispatch_board',
    simulateFeedOutage: 'business/dispatch.go SimulateFeedOutage: WriteWithAudit, edit on ops.live_dispatch_board',
    setMaintenanceMode: 'business/dispatch.go SetMaintenanceMode: WriteWithAudit, edit on admin.data_sources',
    sendFallbackSignal: 'business/dispatch.go SendFallbackSignal: WriteWithAudit, edit on admin.data_sources',
  },
  'demo.ts': { resetDemoData: 'business/demo.go ResetDemoData: WriteWithAudit, platform.demo and the Administrator only' },
};

/**
 * Operations that reach their guard through a helper of the same file (a decision that shares one implementation, a read
 * guard). The test checks that each named helper exists in the file and itself calls a guard.
 */
const GUARD_DELEGATES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'users.ts': { resetEmergencyAdmin: 'the two emergency-account resets share one implementation, which Go guards and audits' },
};

/** Names a browser-supplied value must never have. To name a target (for example the user a preview is about), use targetUserId. */
const FORBIDDEN_PARAMS = /^(ctx|context|customer|customerId|tenantId|userId|zoneScope|installMode|role)$/;
/** The same idea for the fields of an object a server action or route handler takes (any case, with or without underscores). */
const FORBIDDEN_FIELDS = new Set(['ctx', 'context', 'customer', 'customerid', 'tenant', 'tenantid', 'userid', 'role', 'zonescope', 'installmode']);
const normalise = (name: string): string => name.replace(/[_-]/g, '').toLowerCase();

const NOT_DATA_MODULES = new Set(['test-support.ts', 'go-test-reset.ts']);
const OPERATION_MARKER = /operationId:\s*(\(not in the contract\)\s*)?([A-Za-z0-9_]+)/;

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

interface FunctionInfo {
  readonly name: string;
  readonly exported: boolean;
  /** The declaration node (function declaration, or the variable statement of an arrow function). */
  readonly node: ts.Node;
  readonly signature: ts.SignatureDeclaration;
  readonly body: ts.Node | undefined;
  readonly params: readonly string[];
  readonly firstParamType: string | undefined;
  /** JSDoc carries `@pure`. */
  readonly pure: boolean;
  /** The name after `// operationId:`, and whether it says "(not in the contract)". */
  readonly marker: { readonly name: string; readonly notInContract: boolean } | undefined;
}

interface ParsedModule {
  readonly source: ts.SourceFile;
  readonly functions: readonly FunctionInfo[];
  /** Everything declared at the top of the file, by name (functions, consts, classes), for following calls inside a file. */
  readonly declared: ReadonlyMap<string, ts.Node>;
  /** Names imported from./internal/... */
  readonly internalNames: ReadonlySet<string>;
  /** Problems with export statements (`export *`, a re-export of something internal, a default export). */
  readonly exportProblems: readonly string[];
}

function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function markerOf(text: string, node: ts.Node): FunctionInfo['marker'] {
  for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
    const found = OPERATION_MARKER.exec(text.slice(range.pos, range.end));
    if (found?.[2] !== undefined) return { name: found[2], notInContract: found[1] !== undefined };
  }
  return undefined;
}

function isInternalSpecifier(specifier: string): boolean {
  return /(^|\/)internal(\/|$)/.test(specifier);
}

function parseModule(text: string, fileName: string): ParsedModule {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2023, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const functions: FunctionInfo[] = [];
  const declared = new Map<string, ts.Node>();
  const internalNames = new Set<string>();
  const exportProblems: string[] = [];

  // `export { helper };` exports a function declared without the `export` keyword: count it as exported.
  const exportedLocally = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const el of statement.exportClause.elements) if (!el.isTypeOnly) exportedLocally.add((el.propertyName ?? el.name).text);
    }
  }

  const describeFn = (name: string, exported: boolean, node: ts.Node, signature: ts.SignatureDeclaration): FunctionInfo => ({
    name,
    exported: exported || exportedLocally.has(name),
    node,
    signature,
    body: (signature as ts.FunctionLikeDeclaration).body,
    params: signature.parameters.map((p) => p.name.getText(source)),
    firstParamType: signature.parameters[0]?.type?.getText(source),
    pure: ts.getJSDocTags(node).some((tag) => tag.tagName.text === 'pure'),
    marker: markerOf(text, node),
  });

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && isInternalSpecifier(statement.moduleSpecifier.text)) {
      const clause = statement.importClause;
      if (clause !== undefined && !clause.isTypeOnly) {
        if (clause.name !== undefined) internalNames.add(clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) for (const el of bindings.elements) if (!el.isTypeOnly) internalNames.add(el.name.text);
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) internalNames.add(bindings.name.text);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name === undefined && (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0) exportProblems.push('has a default export (name what it exports and give it a context)');
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declared.set(statement.name.text, statement);
      if (statement.body !== undefined) functions.push(describeFn(statement.name.text, isExported(statement), statement, statement));
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declared.set(declaration.name.text, declaration);
        const init = declaration.initializer;
        if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          functions.push(describeFn(declaration.name.text, isExported(statement), statement, init));
        }
      }
    }
    if (ts.isClassDeclaration(statement) && statement.name !== undefined) declared.set(statement.name.text, statement);
    if (ts.isExportAssignment(statement)) exportProblems.push('has a default export (name what it exports and give it a context)');
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const from = statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
      if (statement.exportClause === undefined && from !== undefined) exportProblems.push(`has \`export * from '${from}'\` (re-export names one by one, and never from internal/)`);
      else if (from !== undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause) && isInternalSpecifier(from)) {
        for (const el of statement.exportClause.elements) {
          // Constants and types read nothing; a function re-exported from internal/ would hand a screen what the ban hides.
          if (!el.isTypeOnly && !/^[A-Z][A-Z0-9_]*$/.test(el.name.text)) exportProblems.push(`re-exports ${el.name.text} from '${from}' (keep internal helpers internal)`);
        }
      }
    }
  }
  return { source, functions, declared, internalNames, exportProblems };
}

/** Every identifier that refers to something (not a property name), in a node. */
function referencedNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (ts.isPropertyAssignment(parent) && parent.name === n) ||
        (ts.isQualifiedName(parent) && parent.right === n) ||
        (ts.isPropertySignature(parent) && parent.name === n);
      if (!isPropertyName) names.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** The names of the functions called in a node (`f(...)` and `x.f(...)`). */
function calledNames(node: ts.Node): string[] {
  const calls: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) calls.push(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) calls.push(callee.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return calls;
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/** Whether the second argument of a `writeWithAudit(ctx, guard,...)` call is a real guard. */
function writeGuardIsReal(call: ts.CallExpression, delegates: ReadonlySet<string>): boolean {
  const guard = call.arguments[1];
  if (guard === undefined) return false;
  // A module id (a string, or a constant that holds one): writeWithAudit requires edit on it.
  if (ts.isStringLiteralLike(guard) || ts.isIdentifier(guard) || ts.isPropertyAccessExpression(guard)) return true;
  // A function that throws, or a call that builds one: it must itself call a guard.
  if (ts.isArrowFunction(guard) || ts.isFunctionExpression(guard)) return calledNames(guard.body).some((n) => (GUARD_CALLS.has(n) && !isWriteWithAudit(n)) || delegates.has(n));
  if (ts.isCallExpression(guard)) {
    const name = ts.isIdentifier(guard.expression) ? guard.expression.text : undefined;
    return name !== undefined && (delegates.has(name) || (GUARD_CALLS.has(name) && !isWriteWithAudit(name)));
  }
  return false;
}

function reachesGuard(info: FunctionInfo, delegates: ReadonlySet<string>, guards: ReadonlySet<string> = GUARD_CALLS): boolean {
  if (info.body === undefined) return false;
  let reached = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      if (isWriteWithAudit(name)) reached = reached || writeGuardIsReal(n, delegates);
      else if (guards.has(name) || delegates.has(name)) reached = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(info.body);
  return reached;
}

/** Calls that check or parse input from the caller: they must come after the guard (review finding m2: authorize, then validate). */
const VALIDATOR_CALL = /^(requireId|requireCode|requireFound|requireDate|requireZone|requireRun|requireRelease|requireRoster|requireVersion|requireRuleCode|requireProviderId|parse[A-Z]\w*)$/;

function callsValidator(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && VALIDATOR_CALL.test(callee.text)) found = true;
      // the validators of context.ts: v.object(...), v.string(...)...
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'v') found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** True when a statement before the first guard call of an operation validates or parses what the caller sent. */
function validatesBeforeGuard(info: FunctionInfo, delegates: ReadonlySet<string>, guards: ReadonlySet<string> = GUARD_CALLS): boolean {
  const body = info.body;
  if (body === undefined || !ts.isBlock(body)) return false;
  for (const statement of body.statements) {
    const guarded = calledNames(statement).some((name) => guards.has(name) || delegates.has(name));
    if (guarded) return false;
    if (callsValidator(statement)) return true;
  }
  return false;
}

/** For a `@pure` function: the names it (or a helper of the same file it uses) takes from./internal/. */
function internalReferences(info: FunctionInfo, mod: ParsedModule): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([info.name]);
  const queue: ts.Node[] = [info.node];
  while (queue.length > 0) {
    const node = queue.pop() as ts.Node;
    for (const name of referencedNames(node)) {
      if (mod.internalNames.has(name)) found.add(name);
      const local = mod.declared.get(name);
      if (local !== undefined && !seen.has(name)) {
        seen.add(name);
        queue.push(local);
      }
    }
  }
  return [...found].sort();
}

/**
 * What a pre-session operation may read. It reads `customerId` and `installMode` of its context and nothing
 * else; the request body is touched only through `v.object(body,..., [keys])`, and none of those keys names a role, a user, a
 * zone, an install mode or a customer, so a role or a zone scope can never arrive through the input.
 */
function preSessionReads(info: FunctionInfo, where: string): string[] {
  const problems: string[] = [];
  const contextName = info.params[0];
  const bodyName = info.params[1];
  if (info.body === undefined || contextName === undefined) return problems;
  const visit = (n: ts.Node): void => {
    // pre.role, pre['userId'], pre.zoneScope...: only the two fields of the pre-session context
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === contextName && !PRE_SESSION_FIELDS.has(n.name.text)) {
      problems.push(`${where} reads ${contextName}.${n.name.text}: a pre-session operation may read only ${[...PRE_SESSION_FIELDS].join(' and ')}`);
    }
    if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === contextName) {
      const key = ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : undefined;
      if (key === undefined || !PRE_SESSION_FIELDS.has(key)) problems.push(`${where} reads ${contextName}[...] other than customerId or installMode`);
    }
    // the body goes to v.object(body, 'What', [keys]) and nowhere else; the keys name no identity
    if (bodyName !== undefined && ts.isIdentifier(n) && n.text === bodyName) {
      const parent = n.parent;
      const isParameter = ts.isParameter(parent);
      const isObjectCall = ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'v' && parent.expression.name.text === 'object' && parent.arguments[0] === n;
      if (!isParameter && !isObjectCall) problems.push(`${where} uses its body (${bodyName}) other than as v.object(${bodyName}, ...): read fields from the validated object`);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'v' && n.expression.name.text === 'object') {
      const keys = n.arguments[2];
      if (keys === undefined || !ts.isArrayLiteralExpression(keys)) problems.push(`${where} calls v.object without a closed list of keys (the third argument): a pre-session body must be closed`);
      else {
        for (const key of keys.elements) {
          if (ts.isStringLiteralLike(key) && (FORBIDDEN_FIELDS.has(normalise(key.text)) || /^(assignedrole|zoneids|zoneid)$/.test(normalise(key.text)))) problems.push(`${where} accepts the key "${key.text}" in its body: a role, user, zone, customer or install mode must never come from the input`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(info.body);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The analysis of a data module
// ---------------------------------------------------------------------------------------------

/** Returns what is wrong with the exported functions of one lib/data module. `contractOps` are the operationIds of contracts/openapi.yaml. */
function analyseDataModule(text: string, fileName: string, contractOps: ReadonlySet<string>): string[] {
  const base = path.basename(fileName);
  const mod = parseModule(text, fileName);
  const problems: string[] = mod.exportProblems.map((p) => `${base}: ${p}`);
  const delegates = new Set(Object.keys(GUARD_DELEGATES[base] ?? {}));
  const guardFunctions = new Set(GUARD_FUNCTIONS[base] ?? []);
  const nonContract = NON_CONTRACT_OPERATIONS[base] ?? {};

  for (const fn of mod.functions) {
    if (!fn.exported || CONTEXT_FREE.has(fn.name) || guardFunctions.has(fn.name)) continue;
    const where = `${base}: ${fn.name}(${fn.params.join(', ')})`;

    if (fn.pure) {
      const internal = internalReferences(fn, mod);
      if (internal.length > 0) problems.push(`${where} is tagged @pure but uses ${internal.join(', ')} from ./internal/ (a pure function reads no store: move it to internal/ or drop the tag)`);
      continue;
    }

    const isContract = contractOps.has(fn.name);
    if (fn.marker === undefined && !isContract) {
      problems.push(`${where} is exported but is not an operation (no \`// operationId:\` marker and not a contract operationId), not @pure and not context-free: do not export it, or move it under lib/data/internal/`);
      continue;
    }
    if (fn.marker === undefined) problems.push(`${where} is a contract operation without its \`// operationId: ${fn.name}\` marker`);
    else if (fn.marker.name !== fn.name) problems.push(`${where} carries the marker \`operationId: ${fn.marker.name}\`, which names another function`);
    if (!isContract) {
      if (fn.marker?.notInContract !== true) problems.push(`${where} is not a contract operation: mark it \`// operationId: (not in the contract) ${fn.name}\``);
      if (nonContract[fn.name] === undefined) problems.push(`${where} is an operation the contract lacks and is not in NON_CONTRACT_OPERATIONS (the list is the review)`);
    }
    // The one exception (PRE_SESSION_OPERATIONS): a PreSessionContext first, and requirePreSession as the guard.
    const takesPreSession = fn.firstParamType === 'PreSessionContext';
    const preSessionAllowed = PRE_SESSION_OPERATIONS[base]?.[fn.name] !== undefined;
    if (takesPreSession && !preSessionAllowed) problems.push(`${where} takes a PreSessionContext but is not in PRE_SESSION_OPERATIONS: only the sign-in operations run before a session exists, every other operation takes ctx: RequestContext`);
    if (!(fn.params[0] === 'ctx' && fn.firstParamType === 'RequestContext') && !(takesPreSession && preSessionAllowed)) problems.push(`${where} must start with ctx: RequestContext (or be tagged @pure if it touches no data, or not be exported)`);
    if (preSessionAllowed && !takesPreSession) problems.push(`${where} is listed in PRE_SESSION_OPERATIONS but does not take a PreSessionContext first`);
    const guards = takesPreSession && preSessionAllowed ? PRE_SESSION_GUARD_CALLS : OPERATION_GUARD_CALLS;
    if (takesPreSession && preSessionAllowed) problems.push(...preSessionReads(fn, where));
    if (GO_GUARDED_WRITES[base]?.[fn.name] !== undefined && !takesPreSession) {
      if (!calledNames(fn.node).includes('businessFetch')) problems.push(`${where} is in GO_GUARDED_WRITES but never calls Go (businessFetch)`);
      if (fn.body !== undefined && callsValidator(fn.body)) problems.push(`${where} is in GO_GUARDED_WRITES but validates its input first: Go authorizes, then validates`);
    } else {
      if (validatesBeforeGuard(fn, delegates, guards)) problems.push(`${where} validates or parses its input before its guard runs: authorize first (call the guard, or do the parsing inside the writeWithAudit callback), so a caller who may not write gets forbidden, audited, whatever they send`);
      if (!reachesGuard(fn, delegates, guards)) problems.push(`${where} reaches no guard: call ${takesPreSession ? 'requirePreSession' : 'requireAccess, requirePlatform or checkApproval, or use writeWithAudit/writeWithAuditAsync with a module id or a guard that throws (or name a delegate in GUARD_DELEGATES)'}`);
    }
    for (const param of fn.params.slice(1)) if (FORBIDDEN_PARAMS.test(param)) problems.push(`${where} takes "${param}" as an argument (the context carries it)`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The analysis of a server action or route handler
// ---------------------------------------------------------------------------------------------

interface Sanctioned {
  /** The file (path suffix), the function and the parameter that are allowed to carry these field names. */
  readonly fileSuffix: string;
  readonly functionName: string;
  readonly parameter: string;
  readonly fields: readonly string[];
}

/** setDemoSession takes enum-validated role and install mode (and zone ids) and nothing else. It receives them as `input`. */
const SANCTIONED_ACTION: Sanctioned = { fileSuffix: path.join('lib', 'demo', 'actions.ts'), functionName: 'setDemoSession', parameter: 'input', fields: ['role', 'installMode'] };

const WRAPPER_TYPES = new Set(['Readonly', 'Partial', 'Required', 'Pick', 'Omit', 'NonNullable', 'Awaited', 'Promise']);

function resolveImport(fromFile: string, specifier: string): string | undefined {
  const base = specifier.startsWith('@/') ? path.join(appSrc, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(fromFile), specifier) : undefined;
  if (base === undefined) return undefined;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (fs.existsSync(candidate)) return candidate;
  return undefined;
}

/** The field names a type can carry, looking through literals, interfaces, aliases, intersections and imports (best effort). */
function fieldNames(type: ts.TypeNode | undefined, source: ts.SourceFile, depth = 0): string[] {
  if (type === undefined || depth > 5) return [];
  const names: string[] = [];
  if (ts.isTypeLiteralNode(type)) names.push(...memberFieldNames(type.members, source, depth));
  else if (ts.isParenthesizedTypeNode(type)) names.push(...fieldNames(type.type, source, depth + 1));
  else if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) for (const part of type.types) names.push(...fieldNames(part, source, depth + 1));
  else if (ts.isArrayTypeNode(type)) names.push(...fieldNames(type.elementType, source, depth + 1));
  else if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText(source);
    if (WRAPPER_TYPES.has(name)) for (const arg of type.typeArguments ?? []) names.push(...fieldNames(arg, source, depth + 1));
    else names.push(...referencedTypeFieldNames(name, source, depth + 1));
  }
  return names;
}

function memberFieldNames(members: ts.NodeArray<ts.TypeElement>, file: ts.SourceFile, depth: number): string[] {
  const names: string[] = [];
  for (const member of members) {
    if (member.name !== undefined && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) names.push(member.name.text);
    if (ts.isPropertySignature(member)) names.push(...fieldNames(member.type, file, depth + 1));
  }
  return names;
}

/** The field names of a type named in a file: its interface (and the interfaces it extends) or its alias. */
function referencedTypeFieldNames(name: string, source: ts.SourceFile, depth: number): string[] {
  if (depth > 5) return [];
  const found = findTypeDeclaration(name, source);
  if (found?.decl === undefined) return [];
  if (!ts.isInterfaceDeclaration(found.decl)) return fieldNames(found.decl.type, found.file, depth + 1);
  const names = memberFieldNames(found.decl.members, found.file, depth);
  for (const heritage of found.decl.heritageClauses ?? []) for (const parent of heritage.types) names.push(...referencedTypeFieldNames(parent.expression.getText(found.file), found.file, depth + 1));
  return names;
}

function findTypeDeclaration(name: string, source: ts.SourceFile, depth = 0): { readonly decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined; readonly file: ts.SourceFile } | undefined {
  if (depth > 3) return undefined;
  for (const statement of source.statements) {
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === name) return { decl: statement, file: source };
  }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const imported = bindings.elements.find((el) => el.name.text === name);
    if (imported === undefined) continue;
    const file = resolveImport(source.fileName, statement.moduleSpecifier.text);
    if (file === undefined) return undefined;
    const parsed = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2023, true);
    return findTypeDeclaration((imported.propertyName ?? imported.name).text, parsed, depth + 1);
  }
  return undefined;
}

/** The names bound by a parameter: its own name, the fields it destructures, and the fields of its type. */
function parameterNames(param: ts.ParameterDeclaration, source: ts.SourceFile): { readonly own: string[]; readonly fields: string[] } {
  const own: string[] = [];
  const fields: string[] = [];
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) own.push(name.text);
    else
      for (const el of name.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (ts.isObjectBindingPattern(name)) fields.push((el.propertyName ?? el.name).getText(source).replace(/^['"]|['"]$/g, ''));
        bind(el.name);
      }
  };
  bind(param.name);
  fields.push(...fieldNames(param.type, source));
  return { own, fields };
}

/** Returns what is wrong with the exported functions of one server action or route handler file. */
function analyseActionModule(text: string, fileName: string): string[] {
  const mod = parseModule(text, fileName);
  const problems: string[] = [];
  for (const fn of mod.functions) {
    if (!fn.exported) continue;
    for (const param of fn.signature.parameters) {
      const { own, fields } = parameterNames(param, mod.source);
      const paramName = ts.isIdentifier(param.name) ? param.name.text : undefined;
      const sanctioned = fileName.endsWith(SANCTIONED_ACTION.fileSuffix) && fn.name === SANCTIONED_ACTION.functionName && paramName === SANCTIONED_ACTION.parameter;
      for (const name of own) if (FORBIDDEN_PARAMS.test(name)) problems.push(`${path.basename(fileName)}: ${fn.name} takes "${name}" from the caller`);
      for (const field of fields) {
        if (!FORBIDDEN_FIELDS.has(normalise(field))) continue;
        if (sanctioned && SANCTIONED_ACTION.fields.includes(field)) continue;
        problems.push(`${path.basename(fileName)}: ${fn.name} accepts a "${field}" field from the caller${paramName === undefined ? '' : ` (parameter ${paramName})`}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

function sourceFiles(dir: string, filter: (file: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next') found.push(...sourceFiles(full, filter));
    } else if (filter(full)) found.push(full);
  }
  return found;
}

function dataModules(): string[] {
  return fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !NOT_DATA_MODULES.has(f))
    .map((f) => path.join(dataDir, f));
}

function contractOperationIds(): Set<string> {
  const ids = new Set<string>();
  const paths = getBundledOpenapi().paths as Record<string, unknown>;
  for (const item of Object.values(paths)) {
    if (typeof item !== 'object' || item === null) continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = (item as Record<string, unknown>)[method];
      const id = typeof operation === 'object' && operation !== null ? (operation as Record<string, unknown>)['operationId'] : undefined;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Tests: lib/data
// ---------------------------------------------------------------------------------------------

describe('data layer signatures', () => {
  const contractOps = contractOperationIds();
  const modules = dataModules();
  const parsed = modules.map((file) => ({ file, base: path.basename(file), mod: parseModule(fs.readFileSync(file, 'utf8'), file) }));

  it('finds the data modules and the contract operations', () => {
    expect(modules.length).toBeGreaterThan(20);
    expect(contractOps.size).toBeGreaterThan(200);
    expect(contractOps.has('listCases')).toBe(true);
  });

  it('exports only operations, guards, @pure helpers and the context-free set (nothing that reaches the store without a role check)', () => {
    const problems = modules.flatMap((file) => analyseDataModule(fs.readFileSync(file, 'utf8'), file, contractOps));
    expect(problems).toEqual([]);
  });

  it('has a same-named exported function for every contract operation', () => {
    const exported = new Set(parsed.flatMap((p) => p.mod.functions.filter((f) => f.exported).map((f) => f.name)));
    const missing = [...contractOps].filter((id) => !exported.has(id)).sort();
    expect(missing).toEqual([]);
  });

  it('keeps its allowlists honest: every entry exists, and every delegate really guards', () => {
    const byBase = new Map(parsed.map((p) => [p.base, p.mod] as const));
    const stale: string[] = [];
    for (const [base, names] of Object.entries(NON_CONTRACT_OPERATIONS)) {
      for (const name of Object.keys(names)) {
        const fn = byBase.get(base)?.functions.find((f) => f.name === name);
        if (fn === undefined || !fn.exported) stale.push(`NON_CONTRACT_OPERATIONS ${base}: ${name} is not exported any more`);
        else if (fn.marker?.notInContract !== true) stale.push(`NON_CONTRACT_OPERATIONS ${base}: ${name} lacks its (not in the contract) marker`);
        else if (contractOps.has(name)) stale.push(`NON_CONTRACT_OPERATIONS ${base}: ${name} is a contract operation now: remove the entry`);
      }
    }
    for (const [base, names] of Object.entries(GUARD_DELEGATES)) {
      for (const name of Object.keys(names)) {
        const fn = byBase.get(base)?.functions.find((f) => f.name === name);
        if (fn === undefined) stale.push(`GUARD_DELEGATES ${base}: ${name} does not exist`);
        else if (fn.exported) stale.push(`GUARD_DELEGATES ${base}: ${name} is exported (a delegate is a private helper)`);
        else if (!calledNames(fn.node).some((n) => GUARD_CALLS.has(n) && !isWriteWithAudit(n)) && !reachesGuard(fn, new Set(), OPERATION_GUARD_CALLS)) stale.push(`GUARD_DELEGATES ${base}: ${name} does not call a guard`);
      }
    }
    for (const [base, names] of Object.entries(GO_GUARDED_WRITES)) {
      for (const name of Object.keys(names)) {
        const fn = byBase.get(base)?.functions.find((f) => f.name === name);
        if (fn === undefined || !fn.exported) stale.push(`GO_GUARDED_WRITES ${base}: ${name} is not exported any more`);
        else if (reachesGuard(fn, new Set())) stale.push(`GO_GUARDED_WRITES ${base}: ${name} has a TS guard: remove the entry`);
      }
    }
    const allExported = new Set(parsed.flatMap((p) => p.mod.functions.filter((f) => f.exported).map((f) => f.name)));
    for (const name of CONTEXT_FREE) if (!allExported.has(name)) stale.push(`CONTEXT_FREE: ${name} is not exported any more`);
    for (const [base, names] of Object.entries(GUARD_FUNCTIONS)) for (const name of names) if (byBase.get(base)?.functions.find((f) => f.name === name && f.exported) === undefined) stale.push(`GUARD_FUNCTIONS ${base}: ${name} is not exported any more`);
    expect(stale).toEqual([]);
  });

  it('never re-exports a helper from internal/ and never uses `export *`', () => {
    expect(parsed.flatMap((p) => p.mod.exportProblems.map((problem) => `${p.base}: ${problem}`))).toEqual([]);
  });

  it('is imported by no code outside the tests when it is a test helper (test-support.ts pulls in vitest)', () => {
    const importers = sourceFiles(root, (f) => /\.(ts|tsx|mts)$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') && !f.includes(`${path.sep}node_modules${path.sep}`) && !f.includes(`${path.sep}vendor${path.sep}`))
      .filter((f) => !f.endsWith(path.join('data', 'test-support.ts')))
      .filter((f) => /from ['"][^'"]*test-support['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(importers.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('takes the request context as the first argument of every operation, and never a customer, user, role or zone scope beside it', () => {
    // Part of analyseDataModule; kept as its own test so the two rules of stay visible in the report.
    const violations = modules.flatMap((file) => analyseDataModule(fs.readFileSync(file, 'utf8'), file, contractOps)).filter((p) => p.includes('must start with ctx') || p.includes('as an argument'));
    expect(violations).toEqual([]);
  });

  // the one named exception to "ctx: RequestContext first".
  describe('the pre-session exception (mockSignIn and emergencyAdminSignIn only)', () => {
    const internalDir = path.join(dataDir, 'internal');
    const internalFiles = fs.readdirSync(internalDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => path.join(internalDir, f));
    const relative = (file: string): string => path.relative(dataDir, file).split(path.sep).join('/');
    const takesPreSession = (fn: FunctionInfo, mod: ParsedModule): boolean => fn.signature.parameters.some((param) => (param.type?.getText(mod.source) ?? '').includes('PreSessionContext'));

    it('names exactly the two sign-in operations, each with a reason, and each really takes a PreSessionContext first and reaches requirePreSession', () => {
      expect(Object.keys(PRE_SESSION_OPERATIONS)).toEqual(['identity.ts']);
      expect(Object.keys(PRE_SESSION_OPERATIONS['identity.ts'] ?? {}).sort()).toEqual(['emergencyAdminSignIn', 'mockSignIn']);
      for (const reason of Object.values(PRE_SESSION_OPERATIONS['identity.ts'] ?? {})) expect(reason.length).toBeGreaterThan(20);
      const identity = parsed.find((p) => p.base === 'identity.ts');
      expect(identity).toBeDefined();
      for (const name of Object.keys(PRE_SESSION_OPERATIONS['identity.ts'] ?? {})) {
        const fn = identity?.mod.functions.find((f) => f.name === name && f.exported);
        expect(fn, name).toBeDefined();
        expect(fn?.firstParamType, name).toBe('PreSessionContext');
        expect(fn !== undefined && reachesGuard(fn, new Set(), PRE_SESSION_GUARD_CALLS), `${name} reaches requirePreSession`).toBe(true);
        // a RequestContext guard does not count for it, and requirePreSession does not count for any other operation
        expect(fn !== undefined && calledNames(fn.node).some((n) => GUARD_CALLS.has(n)), `${name} calls no RequestContext guard`).toBe(false);
      }
    });

    it('lets no other function take a PreSessionContext: not another operation, not a helper of a data module, and under internal/ only the audit writer and the alert raiser', () => {
      const offenders: string[] = [];
      const seen = new Set<string>();
      for (const file of [...modules, ...internalFiles]) {
        const rel = relative(file);
        const mod = parseModule(fs.readFileSync(file, 'utf8'), file);
        for (const fn of mod.functions) {
          if (!takesPreSession(fn, mod)) continue;
          seen.add(`${rel}:${fn.name}`);
          const allowed = PRE_SESSION_OPERATIONS[rel]?.[fn.name] !== undefined || (PRE_SESSION_HELPERS[rel] ?? []).includes(fn.name);
          if (!allowed) offenders.push(`${rel}: ${fn.name}(${fn.params.join(', ')}) takes a PreSessionContext`);
        }
      }
      expect(offenders).toEqual([]);
      // the allowlists are honest: every entry exists and takes the type
      const expected = [...Object.entries(PRE_SESSION_OPERATIONS).flatMap(([rel, names]) => Object.keys(names).map((n) => `${rel}:${n}`)), ...Object.entries(PRE_SESSION_HELPERS).flatMap(([rel, names]) => names.map((n) => `${rel}:${n}`))];
      expect([...seen].sort()).toEqual([...expected].sort());
    });

    it('reads nothing but customerId and installMode of its context, touches its body only through a closed v.object, and accepts no role, user, zone or customer key', () => {
      const identity = parsed.find((p) => p.base === 'identity.ts');
      for (const name of Object.keys(PRE_SESSION_OPERATIONS['identity.ts'] ?? {})) {
        const fn = identity?.mod.functions.find((f) => f.name === name);
        expect(fn, name).toBeDefined();
        expect(fn === undefined ? ['missing'] : preSessionReads(fn, name), name).toEqual([]);
      }
    });
  });
});

describe('the data layer scanner catches what it is meant to catch (fail-first fixtures)', () => {
  const ops = new Set(['listThings']);
  const analyse = (text: string, file = 'things.ts'): string[] => analyseDataModule(text, path.join(dataDir, file), ops);

  it('accepts a guarded operation', () => {
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext) { requireAccess(ctx, 'ops.x', 'view'); return readAll('Thing'); }")).toEqual([]);
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext) { return writeWithAudit(ctx, 'admin.x', { action: 'a.b', entity_type: 't' }, () => ({ result: 1, summary_en: 'x' })); }")).toEqual([]);
  });

  it('rejects a ctx-first exported helper that reaches no guard (the review finding M2: putSetting, recordAudit, readableCases)', () => {
    const problems = analyse("export function readableThings(ctx: RequestContext) { return readAll('Thing'); }");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not an operation');
    // marked as an operation, but with no guard in it
    const marked = analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext) { return readAll('Thing'); }");
    expect(marked.join('\n')).toContain('reaches no guard');
  });

  it('rejects a helper that only pretends to guard: writeWithAudit with a guard that checks nothing', () => {
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext) { return writeWithAudit(ctx, () => {}, { action: 'a.b', entity_type: 't' }, () => ({ result: 1, summary_en: 'x' })); }").join('\n')).toContain('reaches no guard');
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext) { return writeWithAudit(ctx, () => requirePlatform(ctx, 'platform.demo'), { action: 'a.b', entity_type: 't' }, () => ({ result: 1, summary_en: 'x' })); }")).toEqual([]);
  });

  it('rejects an operation that validates its input before its guard (review finding m2)', () => {
    const before = analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext, body: unknown) { const input = v.object(body, 'Thing'); requireAccess(ctx, 'ops.x', 'view'); return input; }");
    expect(before.join('\n')).toContain('before its guard');
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext, id: string) { requireId(id, 'Thing'); requireAccess(ctx, 'ops.x', 'view'); }").join('\n')).toContain('before its guard');
    // parsing inside the writeWithAudit callback is the way to do it; reading a hint for the audit event validates nothing
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext, body: unknown) { return writeWithAudit(ctx, 'admin.x', { action: 'a.b', entity_type: 't' }, () => { const input = v.object(body, 'Thing'); return { result: input, summary_en: 'x' }; }); }")).toEqual([]);
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext, body: unknown) { const hint = typeof body === 'object' ? 1 : 0; return writeWithAudit(ctx, 'admin.x', { action: 'a.b', entity_type: String(hint) }, () => ({ result: 1, summary_en: 'x' })); }")).toEqual([]);
  });

  it('rejects an operation that lacks ctx first, and one that takes a role as a separate argument', () => {
    expect(analyse("// operationId: listThings\nexport function listThings(query: object) { requireAccess(query, 'x', 'view'); }").join('\n')).toContain('must start with ctx');
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext, role: string) { requireAccess(ctx, 'x', 'view'); }").join('\n')).toContain('takes "role"');
  });

  it('rejects an operation the contract lacks unless it is in NON_CONTRACT_OPERATIONS', () => {
    const problems = analyse("// operationId: (not in the contract) sneakyThing\nexport function sneakyThing(ctx: RequestContext) { requireAccess(ctx, 'x', 'view'); }");
    expect(problems.join('\n')).toContain('NON_CONTRACT_OPERATIONS');
    expect(analyse("// operationId: sneakyThing\nexport function sneakyThing(ctx: RequestContext) { requireAccess(ctx, 'x', 'view'); }").join('\n')).toContain('(not in the contract)');
  });

  it('rejects a marker that names another function', () => {
    expect(analyse("// operationId: listThings\nexport function otherThing(ctx: RequestContext) { requireAccess(ctx, 'x', 'view'); }").join('\n')).toContain('names another function');
  });

  it('accepts @pure only when the function reads nothing from ./internal/, even through a helper of the same file', () => {
    expect(analyse("import { readAll } from './internal/store';\n/** @pure */\nexport function add(a: number, b: number): number { return a + b; }")).toEqual([]);
    const direct = analyse("import { readAll } from './internal/store';\n/** @pure */\nexport function cheat(a: string): unknown { return readAll(a); }");
    expect(direct.join('\n')).toContain('tagged @pure but uses readAll');
    const indirect = analyse("import { readAll } from './internal/store';\nfunction helper(a: string): unknown { return readAll(a); }\n/** @pure */\nexport function cheat(a: string): unknown { return helper(a); }");
    expect(indirect.join('\n')).toContain('tagged @pure but uses readAll');
    // a type-only import from internal/ is fine, and so is a module that has @pure functions and imports internal for others
    expect(analyse("import type { HasId } from './internal/store';\n/** @pure */\nexport function id(x: HasId): string { return x.id; }")).toEqual([]);
  });

  it('sees a function exported by name after its declaration (`export { helper }`)', () => {
    expect(analyse("function helper(ctx: RequestContext) { return readAll('Thing'); }\nexport { helper };").join('\n')).toContain('helper(ctx) is exported but is not an operation');
    expect(analyse("function helper(ctx: RequestContext) { return readAll('Thing'); }")).toEqual([]);
  });

  it('rejects `export *`, a default export, and a function re-exported from internal/', () => {
    expect(analyse("export * from './internal/store';").join('\n')).toContain('export *');
    expect(analyse("export { putSetting } from './internal/settings-store';").join('\n')).toContain('re-exports putSetting');
    expect(analyse("export { CLOCK_STARTS } from './internal/settings-store';")).toEqual([]);
    expect(analyse('export default function (ctx: RequestContext) {}').join('\n')).toContain('default export');
    expect(analyse("const x = 1;\nexport default x;").join('\n')).toContain('default export');
  });
});

// ---------------------------------------------------------------------------------------------
// The Updates operations are private-install only
// ---------------------------------------------------------------------------------------------

// Go guards the install mode and audits denials
describe('the Updates operations are private-install only, except the summary', () => {
  const file = path.join(dataDir, 'updates.ts');
  const mod = parseModule(fs.readFileSync(file, 'utf8'), file);

  it('agrees with the contract: every admin.updates operation but the summary is `x-install-modes: [private]`, and the summary is not', () => {
    const paths = getBundledOpenapi().paths as Record<string, Record<string, Record<string, unknown>>>;
    const operations = Object.values(paths).flatMap((item) => ['get', 'post', 'put', 'patch', 'delete'].map((method) => item[method]).filter((op): op is Record<string, unknown> => op !== undefined));
    const updates = operations.filter((op) => op['x-module'] === 'admin.updates');
    expect(updates.length).toBeGreaterThan(30);
    const notPrivate = updates.filter((op) => JSON.stringify(op['x-install-modes']) !== JSON.stringify(['private'])).map((op) => op['operationId']);
    expect(notPrivate).toEqual(['getUpdatesSummary']);
    const contractIds = updates.map((op) => String(op['operationId'])).sort();
    const codeIds = mod.functions.filter((fn) => fn.exported).map((fn) => fn.name).sort();
    expect(codeIds).toEqual(contractIds);
  });
});

describe('the pre-session scanner catches what it is meant to catch (fail-first fixtures)', () => {
  const ops = new Set(['mockSignIn', 'emergencyAdminSignIn', 'listThings']);
  const analyse = (text: string, file = 'identity.ts'): string[] => analyseDataModule(text, path.join(dataDir, file), ops);
  const GOOD = "// operationId: mockSignIn\nexport function mockSignIn(pre: PreSessionContext, body: unknown) { requirePreSession(pre); const input = v.object(body, 'Mock sign-in', ['provider_id', 'subject', 'groups']); return [pre.installMode, pre.customerId, input]; }";

  it('accepts a sign-in operation that takes a PreSessionContext, guards with requirePreSession and reads only the two fields', () => {
    expect(analyse(GOOD)).toEqual([]);
    expect(analyse(GOOD.replace('mockSignIn', 'emergencyAdminSignIn').replace('mockSignIn', 'emergencyAdminSignIn'))).toEqual([]);
  });

  it('rejects any other operation that takes a PreSessionContext', () => {
    const other = "// operationId: listThings\nexport function listThings(pre: PreSessionContext) { requirePreSession(pre); return 1; }";
    expect(analyse(other).join('\n')).toContain('not in PRE_SESSION_OPERATIONS');
    // the right name in the wrong file is not the exception either
    expect(analyse(GOOD, 'users.ts').join('\n')).toContain('not in PRE_SESSION_OPERATIONS');
  });

  it('rejects a sign-in operation that does not take a PreSessionContext first, or one that guards with a RequestContext guard only', () => {
    expect(analyse("// operationId: mockSignIn\nexport function mockSignIn(ctx: RequestContext, body: unknown) { requirePlatform(ctx, 'platform.demo'); }").join('\n')).toContain('does not take a PreSessionContext first');
    expect(analyse(GOOD.replace('requirePreSession(pre);', "requirePlatform(pre, 'platform.demo');")).join('\n')).toContain('reaches no guard');
    expect(analyse(GOOD.replace('requirePreSession(pre);', '')).join('\n')).toContain('reaches no guard');
  });

  it('does not let requirePreSession stand in as the guard of an operation that takes a RequestContext', () => {
    expect(analyse("// operationId: listThings\nexport function listThings(ctx: RequestContext) { requirePreSession(ctx); return readAll('Thing'); }").join('\n')).toContain('reaches no guard');
  });

  it('rejects a sign-in operation that validates its body before its guard', () => {
    expect(analyse(GOOD.replace("requirePreSession(pre); const input = v.object(body, 'Mock sign-in', ['provider_id', 'subject', 'groups']);", "const input = v.object(body, 'Mock sign-in', ['provider_id', 'subject', 'groups']); requirePreSession(pre);")).join('\n')).toContain('before its guard');
  });

  it('rejects reading a role, user or zone scope from the context of a visitor', () => {
    for (const read of ['pre.role', "pre['role']", 'pre.userId', 'pre.zoneScope', "pre['zoneScope']"]) {
      expect(analyse(GOOD.replace('pre.customerId', read)).join('\n'), read).toContain('reads pre');
    }
    expect(analyse(GOOD.replace('pre.customerId', 'pre.role')).join('\n')).toContain('reads pre.role');
    expect(analyse(GOOD.replace('pre.customerId', "pre['role']")).join('\n')).toContain('other than customerId or installMode');
  });

  it('rejects a body key that names a role, user, zone, customer or install mode, an open v.object, and a body used any other way', () => {
    for (const key of ['role', 'assigned_role', 'zone_ids', 'user_id', 'customer_id', 'install_mode', 'tenant_id']) {
      expect(analyse(GOOD.replace("'groups']", `'groups', '${key}']`)).join('\n'), key).toContain('must never come from the input');
    }
    expect(analyse(GOOD.replace(", ['provider_id', 'subject', 'groups']", '')).join('\n')).toContain('closed list of keys');
    expect(analyse(GOOD.replace('return [', 'const raw = body; return [raw, ')).join('\n')).toContain('uses its body');
    expect(analyse(GOOD.replace('return [', "const role = (body as Record<string, unknown>)['role']; return [role, ")).join('\n')).toContain('uses its body');
  });
});

// ---------------------------------------------------------------------------------------------
// Tests: server actions and route handlers
// ---------------------------------------------------------------------------------------------

describe('server actions and route handlers', () => {
  const actionFiles = sourceFiles(appSrc, (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')).filter((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return /^\s*['"]use server['"]/m.test(text) || /[\\/]route\.ts$/.test(f);
  });

  it('finds the demo action', () => {
    expect(actionFiles.some((f) => f.endsWith(SANCTIONED_ACTION.fileSuffix))).toBe(true);
  });

  it('accepts no context, customer, tenant, user or role from the browser (as a parameter, a destructured field or a field of its type), except the sanctioned demo action', () => {
    const violations = actionFiles.flatMap((file) => analyseActionModule(fs.readFileSync(file, 'utf8'), file).map((p) => `${path.relative(root, file)}: ${p}`));
    expect(violations).toEqual([]);
  });

  it('keeps the sanctioned action to enum-validated input (it parses with parseDemoSession)', () => {
    const file = actionFiles.find((f) => f.endsWith(SANCTIONED_ACTION.fileSuffix));
    const text = file === undefined ? '' : fs.readFileSync(file, 'utf8');
    expect(text).toContain('parseDemoSession');
    expect(text).not.toMatch(/customerId|tenantId/);
  });

  it('really exempts only role and installMode of `input` in setDemoSession: the exemption is not a no-op', () => {
    const file = actionFiles.find((f) => f.endsWith(SANCTIONED_ACTION.fileSuffix)) as string;
    const text = fs.readFileSync(file, 'utf8');
    // The real file is clean, so without the exemption the scanner would flag the fields of DemoSessionInput...
    const asOtherFile = analyseActionModule(text, path.join(appSrc, 'lib', 'demo', 'other-actions.ts'));
    expect(asOtherFile.join('\n')).toContain('accepts a "role" field');
    expect(asOtherFile.join('\n')).toContain('accepts a "installMode" field');
    //...and the exemption does not cover other names or other functions of the file
    const widened = text.replace('readonly zoneIds: readonly string[];', 'readonly zoneIds: readonly string[];\n  readonly customerId: string;');
    expect(analyseActionModule(widened, file).join('\n')).toContain('"customerId"');
    const renamed = text.replace('export async function setDemoSession(input: DemoSessionInput,', 'export async function setDemoSession(payload: DemoSessionInput,');
    expect(analyseActionModule(renamed, file).join('\n')).toContain('accepts a "role" field');
  });
});

describe('the action scanner catches what it is meant to catch (fail-first fixtures)', () => {
  const analyse = (text: string, file = 'actions.ts'): string[] => analyseActionModule(`'use server';\n${text}`, path.join(appSrc, 'lib', 'fake', file));

  it('rejects an object-typed parameter with a role field: foo(input: { role: string }) (review finding m1)', () => {
    expect(analyse('export async function foo(input: { role: string }) { return input; }').join('\n')).toContain('"role"');
  });

  it('rejects customer, tenant and user fields in any spelling, destructured or typed', () => {
    expect(analyse('export async function a(input: { customerId: string }) {}')).toHaveLength(1);
    expect(analyse('export async function b({ tenant_id }: { tenant_id: string }) {}').length).toBeGreaterThan(0);
    expect(analyse('export async function c({ userId }: { userId: string }) {}').join('\n')).toContain('"userId"');
    expect(analyse('export async function d(input: { customer: string }) {}')).toHaveLength(1);
    expect(analyse('export const e = async (input: { Tenant: string }) => input;')).toHaveLength(1);
  });

  it('rejects the same through interfaces, aliases, intersections and wrappers', () => {
    expect(analyse('interface Body { role: string }\nexport async function f(body: Body) {}')).toHaveLength(1);
    expect(analyse('type Body = { installMode: string };\nexport async function g(body: Body) {}')).toHaveLength(1);
    expect(analyse('type Base = { name: string };\nexport async function h(body: Base & { userId: string }) {}')).toHaveLength(1);
    expect(analyse('export async function i(body: Readonly<{ role: string }>) {}')).toHaveLength(1);
    expect(analyse('interface Inner { role: string }\nexport async function j(body: { nested: Inner }) {}')).toHaveLength(1);
    expect(analyse('export async function POST(request: Request, { params }: { params: { role: string } }) {}', 'route.ts')).toHaveLength(1);
  });

  it('rejects a parameter that is itself called ctx, role or customerId (the old check)', () => {
    expect(analyse('export async function k(role: string) {}')).toHaveLength(1);
    expect(analyse('export async function l(ctx: unknown) {}')).toHaveLength(1);
  });

  it('accepts input that carries no identity', () => {
    expect(analyse("export async function ok(input: { name: string; zoneIds: readonly string[] }, locale: string) { return [input, locale]; }")).toEqual([]);
    expect(analyse('export async function noParams() {}')).toEqual([]);
  });

  it('accepts the sanctioned action only under its own file and function name', () => {
    const text = "export interface DemoSessionInput { readonly role: string; readonly installMode: string; readonly zoneIds: readonly string[] }\nexport async function setDemoSession(input: DemoSessionInput, locale: string) { return [input, locale]; }";
    const sanctionedFile = path.join(appSrc, 'lib', 'demo', 'actions.ts');
    expect(analyseActionModule(text, sanctionedFile)).toEqual([]);
    expect(analyseActionModule(text.replace('setDemoSession', 'setSomethingElse'), sanctionedFile).length).toBeGreaterThan(0);
    expect(analyseActionModule(text, path.join(appSrc, 'lib', 'demo', 'more-actions.ts')).length).toBeGreaterThan(0);
    expect(analyseActionModule(text.replace('readonly zoneIds', 'readonly userId: string; readonly zoneIds'), sanctionedFile).join('\n')).toContain('"userId"');
  });
});
