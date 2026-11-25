// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Contract schema access for scripts and tests (fixture validation, contract checks).
 *
 * STABLE API. Additive changes only; anything else needs the lead's agreement.
 *
 *   listComponentSchemas(): string[]
 *       Sorted names of every schema authored under components.schemas in contracts/openapi.yaml
 *       (for example "Case", "Roster", "ForecastValueList"). Names that Redocly hoists out of the
 *       engine files while bundling are not listed.
 *
 *   getComponentSchema(name: string): object
 *       A fully dereferenced JSON Schema 2020-12 for one component: no $ref remains, nested $id and
 *       $schema are removed, the root carries the 2020-12 $schema. Ready for ajv/dist/2020 with
 *       createAjv(). Throws with a clear message for an unknown name or a circular reference.
 *
 *   listEngineSchemas(): string[]
 *       ["assignment.input", "assignment.output", "forecaster.input", ...]
 *
 *   getEngineSchema(name: string): object
 *       The engine schema exactly as authored (its own $id and $defs), for example
 *       getEngineSchema("forecaster.output"). Accepts "forecaster.output" or
 *       "forecaster.output.schema".
 *
 *   createAjv(): Ajv
 *       An Ajv2020 instance with ajv-formats and the strict settings the contracts are checked
 *       with (strict, strictTypes, allowUnionTypes, allErrors). Use it for every validation so
 *       fixtures are judged exactly like the contracts are.
 *
 *   getBundledOpenapi(): OpenApiDocument
 *       contracts/openapi.yaml bundled to one JSON document (external $ref resolved into
 *       components, internal $ref kept). Used by validate-contracts and generate-types.
 *
 * Implementation note: YAML is parsed by Redocly's bundler (a pinned dev dependency), so this
 * module needs no YAML library. The bundle is cached in memory and on disk under
 * node_modules/.cache/opendispatch-contracts, keyed by a hash of the contract files.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTRACTS_DIR = join(REPO_ROOT, 'contracts');
export const OPENAPI_PATH = join(CONTRACTS_DIR, 'openapi.yaml');
export const UPDATE_AGENT_PATH = join(CONTRACTS_DIR, 'platform', 'update-agent.yaml');
export const ENGINES_DIR = join(CONTRACTS_DIR, 'engines');

const JSON_SCHEMA_2020 = 'https://json-schema.org/draft/2020-12/schema';

/** JSON value as parsed from a bundled contract. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface OpenApiDocument extends JsonObject {
  openapi: string;
  paths: JsonObject;
  components: { schemas: JsonObject } & JsonObject;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------
// Bundling (Redocly CLI, no YAML library needed)
// ---------------------------------------------------------------------------------------------

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out.sort();
}

function contractsHash(): string {
  const hash = createHash('sha256');
  for (const file of listFilesRecursive(CONTRACTS_DIR)) {
    hash.update(file.slice(CONTRACTS_DIR.length));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Bundle any contract YAML to a JSON document using the repo's Redocly CLI. Exported for
 * validate-contracts, which needs the update-agent contract too.
 */
export function bundleYaml(yamlPath: string, outPath: string): void {
  const cli = join(REPO_ROOT, 'node_modules', '@redocly', 'cli', 'bin', 'cli.js');
  if (!existsSync(cli)) {
    throw new Error(`@redocly/cli is not installed (expected ${cli}). Run pnpm install.`);
  }
  try {
    execFileSync(process.execPath, [cli, 'bundle', yamlPath, '--output', outPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true', CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const err = error as { stdout?: Buffer; stderr?: Buffer; message: string };
    const detail = `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`.trim();
    throw new Error(`Bundling ${yamlPath} failed:\n${detail || err.message}`);
  }
}

let bundledMemo: OpenApiDocument | undefined;

export function getBundledOpenapi(): OpenApiDocument {
  if (bundledMemo) return bundledMemo;
  const cacheDir = join(REPO_ROOT, 'node_modules', '.cache', 'opendispatch-contracts');
  mkdirSync(cacheDir, { recursive: true });
  const cacheFile = join(cacheDir, `openapi.${contractsHash()}.json`);
  if (!existsSync(cacheFile)) {
    const tmp = join(cacheDir, `openapi.${process.pid}.tmp.json`);
    bundleYaml(OPENAPI_PATH, tmp);
    renameSync(tmp, cacheFile);
  }
  bundledMemo = JSON.parse(readFileSync(cacheFile, 'utf8')) as OpenApiDocument;
  return bundledMemo;
}

// ---------------------------------------------------------------------------------------------
// Component schemas
// ---------------------------------------------------------------------------------------------

/** Names authored in contracts/openapi.yaml under components.schemas, read from the source text. */
function authoredComponentNames(): string[] {
  const lines = readFileSync(OPENAPI_PATH, 'utf8').split(/\r?\n/);
  const names: string[] = [];
  let inComponents = false;
  let inSchemas = false;
  for (const line of lines) {
    if (/^components:\s*$/.test(line)) {
      inComponents = true;
      continue;
    }
    if (!inComponents) continue;
    if (/^\S/.test(line) && !line.startsWith('#')) break; // next top-level key
    if (/^ {2}schemas:\s*$/.test(line)) {
      inSchemas = true;
      continue;
    }
    if (inSchemas && /^ {2}\S/.test(line) && !line.startsWith('  #')) {
      inSchemas = false; // next section under components
      continue;
    }
    if (inSchemas) {
      const match = /^ {4}([A-Za-z0-9_.-]+):/.exec(line);
      if (match?.[1]) names.push(match[1]);
    }
  }
  return names;
}

let namesMemo: string[] | undefined;

export function listComponentSchemas(): string[] {
  namesMemo ??= [...new Set(authoredComponentNames())].sort();
  return [...namesMemo];
}

const COMPONENT_REF = /^#\/components\/schemas\/([^/]+)$/;

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function deref(node: Json, components: JsonObject, stack: string[]): Json {
  if (Array.isArray(node)) return node.map((item) => deref(item, components, stack));
  if (!isObject(node)) return node;

  const ref = node['$ref'];
  if (typeof ref === 'string') {
    const match = COMPONENT_REF.exec(ref);
    if (!match?.[1]) {
      throw new Error(`Unsupported $ref "${ref}" after bundling; only #/components/schemas/<Name> is expected.`);
    }
    const name = decodePointerToken(match[1]);
    if (stack.includes(name)) {
      throw new Error(`Circular $ref: ${[...stack, name].join(' -> ')}. Contracts must not be recursive.`);
    }
    const target = components[name];
    if (target === undefined) throw new Error(`$ref to unknown component schema "${name}".`);
    const resolved = deref(target, components, [...stack, name]);
    const siblings: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== '$ref') siblings[key] = deref(value, components, stack);
    }
    return isObject(resolved) ? { ...resolved, ...siblings } : resolved;
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    // Keep property names and example values untouched; only schema keywords are walked, which
    // is safe because $ref never appears as data in these contracts.
    out[key] = deref(value, components, stack);
  }
  return out;
}

function stripNestedIdentifiers(node: Json): Json {
  if (Array.isArray(node)) return node.map((item) => stripNestedIdentifiers(item));
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === '$id' || key === '$schema') && typeof value === 'string') continue;
    out[key] = stripNestedIdentifiers(value);
  }
  return out;
}

export function getComponentSchema(name: string): object {
  const authored = listComponentSchemas();
  if (!authored.includes(name)) {
    const close = authored.filter((n) => n.toLowerCase().includes(name.toLowerCase())).slice(0, 8);
    throw new Error(
      `Unknown component schema "${name}".${close.length ? ` Did you mean: ${close.join(', ')}?` : ''} Use listComponentSchemas() for all ${authored.length} names.`,
    );
  }
  const components = getBundledOpenapi().components.schemas;
  const start = components[name];
  if (start === undefined) throw new Error(`Component schema "${name}" is missing from the bundled contract.`);
  const dereferenced = deref(start, components, [name]);
  const cleaned = stripNestedIdentifiers(dereferenced);
  if (!isObject(cleaned)) throw new Error(`Component schema "${name}" is not a schema object.`);
  return { $schema: JSON_SCHEMA_2020, ...cleaned };
}

// ---------------------------------------------------------------------------------------------
// Engine schemas
// ---------------------------------------------------------------------------------------------

export function listEngineSchemas(): string[] {
  return readdirSync(ENGINES_DIR)
    .filter((file) => file.endsWith('.schema.json'))
    .map((file) => file.replace(/\.schema\.json$/, ''))
    .sort();
}

export function getEngineSchema(name: string): object {
  const base = name.replace(/\.schema(\.json)?$/, '').replace(/\.json$/, '');
  const file = join(ENGINES_DIR, `${base}.schema.json`);
  if (!existsSync(file)) {
    throw new Error(`Unknown engine schema "${name}". Available: ${listEngineSchemas().join(', ')}.`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as object;
}

// ---------------------------------------------------------------------------------------------
// Ajv
// ---------------------------------------------------------------------------------------------

type AjvCtor = new (options: Record<string, unknown>) => import('ajv').default;
type FormatsFn = (ajv: import('ajv').default) => import('ajv').default;

function unwrapDefault<T>(mod: unknown): T {
  const candidate = mod as { default?: unknown };
  return (candidate.default && (candidate.default as { default?: unknown }).default
    ? (candidate.default as { default: unknown }).default
    : (candidate.default ?? mod)) as T;
}

export function createAjv(): import('ajv').default {
  const Ajv2020 = unwrapDefault<AjvCtor>(Ajv2020Module);
  const addFormats = unwrapDefault<FormatsFn>(addFormatsModule);
  const ajv = new Ajv2020({
    strict: true,
    strictTypes: true,
    strictTuples: true,
    strictRequired: false,
    allowUnionTypes: true,
    allErrors: true,
  });
  addFormats(ajv);
  return ajv;
}
