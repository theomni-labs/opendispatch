// SPDX-License-Identifier: AGPL-3.0-only
// The synthetic data generator. Reads ONLY scripts/synthetic/calibration.json.
// Deterministic: one seed, in-repo mulberry32, no Math.random, no clock. Running it twice gives byte-identical files.
//
//   pnpm generate:fixtures                 writes fixtures/, fixtures/manifest.json and apps/web/public/samples/*.csv
//   pnpm generate:fixtures -- --out <dir>  writes somewhere else, samples under <dir>/samples (tests use this)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibration } from './gen/calibration';
import { makeCtx } from './gen/context';
import { buildFixtures } from './gen/build-all';
import { buildSamples } from './gen/build-samples';
import { cleanPreviousOutput, writeFixtures, writeManifest, writeSamples } from './gen/io';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
/** The web app serves the import samples as static files. */
export const SAMPLES_ROOT = path.join(repoRoot, 'apps', 'web', 'public');

export function main(outDir = path.join(repoRoot, 'fixtures'), samplesRoot = outDir === path.join(repoRoot, 'fixtures') ? SAMPLES_ROOT : outDir): { files: number; bytes: number } {
  const started = process.hrtime.bigint();
  const ctx = makeCtx();
  const files = buildFixtures(ctx);
  cleanPreviousOutput(outDir);
  const { entries, bytes } = writeFixtures(outDir, files);
  writeManifest(outDir, entries, {
    generator: 'scripts/synthetic/generate.ts',
    seed: calibration.structure.seed.value,
    tenant_id: ctx.tenantId,
    data_source: 'SYNTHETIC',
    note: 'Generated. Do not edit by hand: run pnpm generate:fixtures. Every figure derived from these files is Illustrative.',
  });
  // The sample import files of the Admin screens (not fixtures of a schema: the manifest does not list them).
  writeSamples(samplesRoot, buildSamples(ctx));
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  console.log(`Wrote ${entries.length} fixture files (${(bytes / 1024 / 1024).toFixed(2)} MB) and manifest.json to ${path.relative(process.cwd(), outDir) || '.'} in ${ms} ms.`);
  return { files: entries.length, bytes };
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (outIndex >= 0 && out === undefined) throw new Error('--out needs a directory');
  main(out === undefined ? undefined : path.resolve(out));
}
