// SPDX-License-Identifier: AGPL-3.0-only
// Writing fixtures: compact but diffable JSON, stable byte for byte. Node-only.

import fs from 'node:fs';
import path from 'node:path';

export interface ManifestEntry {
  readonly path: string;
  readonly schema: string;
  readonly kind: 'array' | 'object';
  readonly count: number;
  /** Set when `schema` is a fixture-only name that reuses a contract schema (for example ReplayCase is a Case). */
  readonly contract_schema?: string;
}

/** An array with one element per line, each element compact JSON. */
export function stringifyArray(rows: readonly unknown[]): string {
  if (rows.length === 0) return '[]\n';
  return `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
}

/**
 * An object with one top-level key per line. Values that are arrays go one element per line so large lists diff
 * well; every other value is compact JSON.
 */
export function stringifyObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const lines = keys.map((k) => {
    const v = obj[k];
    if (Array.isArray(v) && v.length > 0) return `${JSON.stringify(k)}: [\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]`;
    return `${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

export interface FixtureFile {
  readonly path: string; // relative to the fixtures directory, forward slashes
  readonly schema: string;
  readonly kind: 'array' | 'object';
  readonly data: readonly unknown[] | Record<string, unknown>;
  readonly contract_schema?: string;
}

export function writeFixtures(dir: string, files: readonly FixtureFile[]): { entries: ManifestEntry[]; bytes: number } {
  const entries: ManifestEntry[] = [];
  let bytes = 0;
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const full = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const text = f.kind === 'array' ? stringifyArray(f.data as readonly unknown[]) : stringifyObject(f.data as Record<string, unknown>);
    fs.writeFileSync(full, text, 'utf8');
    bytes += Buffer.byteLength(text, 'utf8');
    entries.push({ path: f.path, schema: f.schema, kind: f.kind, count: f.kind === 'array' ? (f.data as readonly unknown[]).length : 1, ...(f.contract_schema === undefined ? {} : { contract_schema: f.contract_schema }) });
  }
  return { entries, bytes };
}

/**
 * The sample import files (apps/web/public/samples/*.csv, served as static files). They are not fixtures of a schema, so the manifest does not list them; they are
 * overwritten on every run (deterministic), never deleted.
 */
export function writeSamples(dir: string, samples: readonly { readonly path: string; readonly text: string }[]): number {
  let bytes = 0;
  for (const sample of samples) {
    const full = path.join(dir, sample.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, sample.text, 'utf8');
    bytes += Buffer.byteLength(sample.text, 'utf8');
  }
  return bytes;
}

export function writeManifest(dir: string, entries: readonly ManifestEntry[], meta: Record<string, unknown>): void {
  const text = `{\n${Object.entries(meta)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n')},\n"files": [\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n}\n`;
  fs.writeFileSync(path.join(dir, 'manifest.json'), text, 'utf8');
}

/**
 * Remove the files the previous run wrote (the ones its manifest lists), then any empty directories, so a renamed or
 * dropped file never lingers. Files the generator did not write are left alone.
 */
export function cleanPreviousOutput(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { files?: { path: string }[] };
      for (const f of old.files ?? []) fs.rmSync(path.join(dir, f.path), { force: true });
    } catch {
      // an unreadable manifest: fall through and overwrite it
    }
    fs.rmSync(manifestPath, { force: true });
  }
  const prune = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        prune(path.join(d, entry.name));
        if (fs.readdirSync(path.join(d, entry.name)).length === 0) fs.rmdirSync(path.join(d, entry.name));
      }
    }
  };
  prune(dir);
}
