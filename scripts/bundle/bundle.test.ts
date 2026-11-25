// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = path.join(root, 'scripts/bundle/bundle.sh');
const load = path.join(root, 'scripts/bundle/load.sh');
const templates = path.join(root, 'deploy/helm/opendispatch/templates');
const ours = new Set(['api', 'worker', 'web', 'engines']);
const dig = (c: string): string => 'sha256:' + c.repeat(64);

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function thirdParty(env: Record<string, string> = {}) {
  return run(bundle, ['--list-third-party'], env);
}

describe('bundle.sh third-party images', () => {
  it('lists every non-OpenDispatch image the chart runs, pinned by tag and digest', () => {
    const used = new Set<string>();
    for (const f of readdirSync(templates)) {
      for (const m of readFileSync(path.join(templates, f), 'utf8').matchAll(/Values\.images\.([a-z]+)/g)) {
        if (!ours.has(m[1]!)) used.add(m[1]!);
      }
    }
    const res = thirdParty();
    expect(res.status).toBe(0);
    const lines = res.stdout.trim().split('\n').map((l) => l.split(' '));
    expect(new Set(lines.map((l) => l[0]))).toEqual(used);
    const kc = lines.find((l) => l[0] === 'keycloak')!;
    expect(kc[1]).toBe('quay.io/keycloak/keycloak');
    expect(kc[2]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(kc[3]).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('reads flow and block entries and refuses one without a digest', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bundle-'));
    const values = path.join(dir, 'values.yaml');
    writeFileSync(
      values,
      [
        'global:',
        '  imageRegistry: ""',
        'images:',
        '  api: { repository: opendispatch-api, tag: "", digest: "" }',
        `  proxy: { repository: example.org/proxy, tag: "2.1", digest: "${dig('a')}" }`,
        '  # comment',
        '  store:',
        '    repository: example.org/store',
        '    tag: "7"',
        `    digest: "${dig('b')}"`,
        'other:',
        '  repository: no',
      ].join('\n'),
    );
    const ok = thirdParty({ OPENDISPATCH_BUNDLE_VALUES: values });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim().split('\n')).toEqual([
      `proxy example.org/proxy 2.1 ${dig('a')}`,
      `store example.org/store 7 ${dig('b')}`,
    ]);
    writeFileSync(values, 'images:\n  proxy: { repository: example.org/proxy, tag: "2.1" }\n');
    const bad = thirdParty({ OPENDISPATCH_BUNDLE_VALUES: values });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('images.proxy');
  });
});

// a bundle of fake tars, and a k3s that logs its calls
function fakeBundle(entries: { name: string; image: string; digest?: string }[], imported: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'load-'));
  const b = path.join(dir, 'bundle');
  mkdirSync(path.join(b, 'images'), { recursive: true });
  const lines = entries.map((e) => {
    writeFileSync(path.join(b, 'images', `${e.name}.tar`), e.name);
    const extra = e.digest ? `"image_name": "${e.image}", "digest": "${e.digest}", ` : '';
    return `    {"name": "${e.name}", "ref": "${e.image}", ${extra}"file": "images/${e.name}.tar", "bytes": 1}`;
  });
  writeFileSync(path.join(b, 'manifest.json'), `{\n  "images": [\n${lines.join(',\n')}\n  ]\n}\n`);
  const files = ['manifest.json', ...entries.map((e) => `images/${e.name}.tar`)].sort();
  const sums = spawnSync('sha256sum', files.map((f) => `./${f}`), { cwd: b, encoding: 'utf8' }).stdout;
  writeFileSync(path.join(b, 'SHA256SUMS'), sums);
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const log = path.join(dir, 'calls.log');
  writeFileSync(
    path.join(bin, 'k3s'),
    [
      '#!/usr/bin/env bash',
      `echo "$*" >> ${log}`,
      'if [ "$2 $3" = "images ls" ]; then',
      '  echo "REF TYPE DIGEST SIZE PLATFORMS LABELS"',
      `  echo "\${4#name==} application/vnd.oci.image.index.v1+json ${imported} 1 linux/amd64 -"`,
      'fi',
    ].join('\n'),
  );
  chmodSync(path.join(bin, 'k3s'), 0o755);
  return { b, log, env: { PATH: `${bin}:${process.env.PATH}` } };
}

describe('load.sh on k3s', () => {
  const kc = 'quay.io/keycloak/keycloak:26.8.0';

  it('adds the name@digest reference a digest-pinned chart needs', () => {
    const f = fakeBundle([{ name: 'keycloak', image: kc, digest: dig('c') }], dig('c'));
    const res = run(load, ['--bundle', f.b, '--runtime', 'k3s'], f.env);
    expect(res.status, res.stderr).toBe(0);
    const calls = readFileSync(f.log, 'utf8').trim().split('\n');
    expect(calls[0]).toBe(`ctr images import ${f.b}/images/keycloak.tar`);
    expect(calls).toContain(`ctr images tag --force ${kc} quay.io/keycloak/keycloak@${dig('c')}`);
  });

  it('refuses when the imported image is not the pinned digest', () => {
    const f = fakeBundle([{ name: 'keycloak', image: kc, digest: dig('c') }], dig('d'));
    const res = run(load, ['--bundle', f.b, '--runtime', 'k3s'], f.env);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain(`not ${dig('c')}`);
    expect(readFileSync(f.log, 'utf8')).not.toContain('images tag');
  });

  it('imports an older bundle with no digests as before', () => {
    const f = fakeBundle([{ name: 'api', image: 'opendispatch-api:1' }], dig('c'));
    const res = run(load, ['--bundle', f.b, '--runtime', 'k3s'], f.env);
    expect(res.status, res.stderr).toBe(0);
    expect(readFileSync(f.log, 'utf8').trim()).toBe(`ctr images import ${f.b}/images/api.tar`);
  });
});
