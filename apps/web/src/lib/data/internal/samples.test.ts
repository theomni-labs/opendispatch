// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './fixtures';
import { SAMPLE_FILES, sampleText, type SampleFile } from './samples';

describe('the import samples, static files of the web app', () => {
  it('reads both from apps/web/public/samples, where Next serves them at /samples/', () => {
    for (const name of SAMPLE_FILES) {
      const file = path.join(repoRoot(), 'apps', 'web', 'public', 'samples', name);
      expect(sampleText(name)).toBe(fs.readFileSync(file, 'utf8'));
      expect(sampleText(name).split('\n')[0]).toContain(',');
    }
  });

  it('refuses any other name', () => {
    expect(() => sampleText('../../../../fixtures/manifest.json' as SampleFile)).toThrow('Not a sample file');
  });

  it('no longer reads fixtures/, so the web image ships without it', () => {
    expect(fs.existsSync(path.join(repoRoot(), 'fixtures', 'samples', 'locations_sample.csv'))).toBe(false);
    expect(fs.readFileSync(path.join(repoRoot(), 'apps', 'web', 'Dockerfile'), 'utf8')).not.toMatch(/\/repo\/fixtures/);
  });
});
