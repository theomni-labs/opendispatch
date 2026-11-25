// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generates TypeScript types from the contracts into apps/web/src/lib/types/. Never edit the output.
 *
 *   contracts/openapi.yaml               -> api.ts            (openapi-typescript)
 *   contracts/platform/update-agent.yaml -> update-agent.ts   (openapi-typescript)
 *   contracts/engines/<name>.schema.json -> engines/<name>.ts (json-schema-to-typescript)
 *   every component schema + engine types -> index.ts          (barrel)
 *
 * Usage:
 *   pnpm generate:types           write the files
 *   pnpm generate:types --check   write nothing; exit 1 if the files on disk differ from a fresh run
 *
 * Output is deterministic: stable ordering, no timestamps, fixed formatting.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript';
import { compile } from 'json-schema-to-typescript';
import {
  ENGINES_DIR,
  OPENAPI_PATH,
  REPO_ROOT,
  UPDATE_AGENT_PATH,
  getBundledOpenapi,
  getEngineSchema,
  listComponentSchemas,
  listEngineSchemas,
} from './schemas.js';

const OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'src', 'lib', 'types');
const ENGINES_OUT_DIR = join(OUT_DIR, 'engines');
const CHECK = process.argv.includes('--check');

function header(source: string): string {
  return [
    '/**',
    ' * GENERATED, do not edit.',
    ` * Source: ${source}`,
    ' * Regenerate with: pnpm generate:types',
    ' * The contracts under contracts/ are the single source of truth for these types.',
    ' */',
    '',
    '',
  ].join('\n');
}

interface Output {
  path: string;
  content: string;
}

/** JSON Schema keywords that describe the engine file itself, not the payload. */
const ENGINE_FILE_KEYWORDS = ['$defs', '$id', '$schema', 'examples'] as const;

/**
 * contracts/openapi.yaml bundled to one document, with the engine files' own bookkeeping removed
 * from the schemas Redocly hoisted out of them. Without this openapi-typescript turns `$defs` into a
 * required property of the engine output types, so no valid document could satisfy them. The
 * $defs themselves are already hoisted into components.schemas by the bundler and every $ref
 * points there, which is checked here.
 */
function cleanedOpenapiDocument(): OpenAPI3 {
  const doc = structuredClone(getBundledOpenapi()) as unknown as {
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  const text = JSON.stringify(doc);
  if (text.includes('/$defs/')) {
    throw new Error('The bundled OpenAPI document still refers into an engine file\'s $defs; expected every $ref to point at components.schemas.');
  }
  let cleaned = 0;
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    if (!name.endsWith('.schema')) continue;
    for (const keyword of ENGINE_FILE_KEYWORDS) delete schema[keyword];
    cleaned += 1;
  }
  if (cleaned === 0) throw new Error('No hoisted engine schemas found in the bundled OpenAPI document.');
  return doc as unknown as OpenAPI3;
}

async function generateOpenapi(yamlPath: string, outFile: string): Promise<Output> {
  const source = relative(REPO_ROOT, yamlPath);
  const input = yamlPath === OPENAPI_PATH ? cleanedOpenapiDocument() : pathToFileURL(yamlPath);
  const ast = await openapiTS(input, { alphabetize: true });
  return { path: join(OUT_DIR, outFile), content: header(source) + astToString(ast) };
}

async function generateEngine(name: string): Promise<{ output: Output; typeName: string }> {
  const schema = getEngineSchema(name) as { title?: string };
  const typeName = schema.title;
  if (!typeName) throw new Error(`Engine schema ${name} needs a title; it names the generated type.`);
  const body = await compile(schema as Parameters<typeof compile>[0], typeName, {
    bannerComment: '',
    additionalProperties: false,
    strictIndexSignatures: true,
    // minItems and maxItems stay in the schema (and are enforced by validation). As TypeScript they
    // would become tuples such as [T, ...T[]], which rejects ordinary arrays and would make these
    // types differ from the openapi-typescript ones.
    ignoreMinAndMaxItems: true,
    unreachableDefinitions: false,
    cwd: ENGINES_DIR,
    format: true,
    style: {
      bracketSpacing: true,
      printWidth: 100,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'all',
      useTabs: false,
    },
    $refOptions: { resolve: { http: false, external: false } },
  });
  if (!new RegExp(`export (interface|type) ${typeName}\\b`).test(body)) {
    throw new Error(`Generated engine file for ${name} does not export ${typeName}.`);
  }
  const source = `contracts/engines/${name}.schema.json`;
  return { output: { path: join(ENGINES_OUT_DIR, `${name}.ts`), content: header(source) + body }, typeName };
}

function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function barrel(engineExports: { file: string; typeName: string }[]): Output {
  const names = listComponentSchemas().filter(isIdentifier);
  const lines: string[] = [
    header('contracts/openapi.yaml, contracts/platform/update-agent.yaml, contracts/engines/*.schema.json').trimEnd(),
    '',
  ];
  lines.push("import type { components } from './api';");
  lines.push('');
  lines.push("export type { components, operations, paths } from './api';");
  lines.push("export type { components as UpdateAgentComponents, operations as UpdateAgentOperations, paths as UpdateAgentPaths } from './update-agent';");
  lines.push('');
  lines.push('// Every schema under components.schemas of contracts/openapi.yaml, by its plain name.');
  for (const name of names) {
    lines.push(`export type ${name} = components['schemas']['${name}'];`);
  }
  lines.push('');
  lines.push('// Engine inputs and outputs (contracts/engines).');
  for (const { file, typeName } of engineExports) {
    lines.push(`export type { ${typeName} } from './engines/${file}';`);
  }
  lines.push('');
  return { path: join(OUT_DIR, 'index.ts'), content: lines.join('\n') };
}

function assertUniqueNames(engineTypeNames: string[]): void {
  const component = new Set(listComponentSchemas());
  const clash = engineTypeNames.filter((n) => component.has(n));
  if (clash.length > 0) {
    throw new Error(`Engine type names clash with component schema names in the barrel: ${clash.join(', ')}`);
  }
}

function listGeneratedFiles(): string[] {
  const out: string[] = [];
  if (!existsSync(OUT_DIR)) return out;
  for (const entry of readdirSync(OUT_DIR)) {
    if (entry.endsWith('.ts')) out.push(join(OUT_DIR, entry));
  }
  if (existsSync(ENGINES_OUT_DIR)) {
    for (const entry of readdirSync(ENGINES_OUT_DIR)) {
      if (entry.endsWith('.ts')) out.push(join(ENGINES_OUT_DIR, entry));
    }
  }
  return out.sort();
}

async function main(): Promise<void> {
  const outputs: Output[] = [];
  outputs.push(await generateOpenapi(OPENAPI_PATH, 'api.ts'));
  outputs.push(await generateOpenapi(UPDATE_AGENT_PATH, 'update-agent.ts'));

  const engineExports: { file: string; typeName: string }[] = [];
  for (const name of listEngineSchemas()) {
    const { output, typeName } = await generateEngine(name);
    outputs.push(output);
    engineExports.push({ file: name, typeName });
  }
  assertUniqueNames(engineExports.map((e) => e.typeName));
  outputs.push(barrel(engineExports));

  if (CHECK) {
    const expected = new Map(outputs.map((o) => [o.path, o.content]));
    const problems: string[] = [];
    for (const [path, content] of expected) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
      if (current === undefined) problems.push(`missing: ${relative(REPO_ROOT, path)}`);
      else if (current !== content) problems.push(`out of date: ${relative(REPO_ROOT, path)}`);
    }
    for (const path of listGeneratedFiles()) {
      if (!expected.has(path)) problems.push(`stale (no contract): ${relative(REPO_ROOT, path)}`);
    }
    if (problems.length > 0) {
      console.error(`Generated types are not current:\n  ${problems.join('\n  ')}\nRun: pnpm generate:types`);
      process.exit(1);
    }
    console.log(`generate:types --check: ${expected.size} files are current.`);
    return;
  }

  mkdirSync(ENGINES_OUT_DIR, { recursive: true });
  const expectedPaths = new Set(outputs.map((o) => o.path));
  for (const stale of listGeneratedFiles()) {
    if (!expectedPaths.has(stale)) rmSync(stale);
  }
  for (const { path, content } of outputs) writeFileSync(path, content, 'utf8');
  for (const { path, content } of outputs) {
    console.log(`wrote ${relative(REPO_ROOT, path)} (${content.split('\n').length} lines)`);
  }
  console.log(`generate:types: ${outputs.length} files written.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
