// SPDX-License-Identifier: AGPL-3.0-only
// Import samples: static files in public/samples.

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './fixtures';

export const SAMPLE_FILES = ['locations_sample.csv', 'agents_sample.csv'] as const;

export type SampleFile = (typeof SAMPLE_FILES)[number];

/** One sample's text; other names are refused. */
export function sampleText(name: SampleFile): string {
  if (!(SAMPLE_FILES as readonly string[]).includes(name)) throw new Error(`Not a sample file: ${name}`);
  return fs.readFileSync(path.join(repoRoot(), 'apps', 'web', 'public', 'samples', name), 'utf8');
}
