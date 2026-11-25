// SPDX-License-Identifier: AGPL-3.0-only
// Prints the slowest tests and the cost of signing in, from the JSON reports in e2e-output/.
//   node scripts/timings.mjs [top]
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '../e2e-output');
const top = Number(process.argv[2] ?? 15);
const tests = [];
let signIn = { count: 0, ms: 0, max: 0 };

function steps(list, into) {
  for (const step of list ?? []) {
    if (step.title === 'sign-in') into.push(step.duration);
    steps(step.steps, into);
  }
}

function walk(suite, file, report) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      for (const r of t.results ?? []) {
        const ins = [];
        steps(r.steps, ins);
        for (const d of ins) signIn = { count: signIn.count + 1, ms: signIn.ms + d, max: Math.max(signIn.max, d) };
        tests.push({ report, title: `${spec.title} [${t.projectName ?? ''}]`, ms: r.duration, signIn: ins.reduce((a, b) => a + b, 0) });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, file, report);
}

for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!/^timings-.*\.json$/.test(name)) continue;
  const json = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  if (json.suites) for (const suite of json.suites) walk(suite, suite.file, name);
  if (json.testResults) {
    for (const file of json.testResults) for (const a of file.assertionResults ?? []) tests.push({ report: name, title: `${path.basename(file.name)} > ${a.fullName}`, ms: a.duration ?? 0, signIn: 0 });
  }
}

tests.sort((a, b) => b.ms - a.ms);
const total = tests.reduce((a, t) => a + t.ms, 0);
console.log(`${String(tests.length)} tests, ${(total / 1000).toFixed(0)}s of test time`);
for (const t of tests.slice(0, top)) console.log(`${(t.ms / 1000).toFixed(1).padStart(7)}s  ${t.signIn > 0 ? `(sign-in ${(t.signIn / 1000).toFixed(1)}s) ` : ''}${t.title.slice(0, 120)}`);
if (signIn.count > 0) console.log(`sign-in: ${String(signIn.count)} times, ${(signIn.ms / 1000).toFixed(0)}s in all (${(signIn.ms / signIn.count / 1000).toFixed(1)}s each, slowest ${(signIn.max / 1000).toFixed(1)}s), ${((signIn.ms / total) * 100).toFixed(0)}% of test time`);
