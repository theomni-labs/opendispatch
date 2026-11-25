// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { messageLeaves } from '@/i18n/message-tree';
import { loadMessages } from '@/i18n/messages';

// The Arabic Audit Log shows a label per action code instead of the English sentence. An action without a label falls back to
// the English text, so this keeps the catalogue complete for every action the fixtures and the Go api are known to write.

const root = path.join(import.meta.dirname, '../../../../../..');
const keyOf = (action: string): string => `admin.audit_log.act.${action.replaceAll('.', '__')}`;

function goActions(): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) for (const m of fs.readFileSync(full, 'utf8').matchAll(/Action:\s*"([a-z][a-z0-9_.]*)"/g)) found.add(m[1] as string);
    }
  };
  walk(path.join(root, 'apps/api-go/internal'));
  found.delete('test.audit');
  return [...found].sort();
}

// The actions of the seeded fixture events (fixtures/admin/audit_events.json); a test outside lib/data may not read fixtures.
const fixtureActions = ['assignment.fallback_triggered', 'auth.emergency_sign_in', 'auth.sign_in', 'demo.load', 'import.cut_over', 'integration.health_changed', 'model.activate', 'override.approve', 'roster.approve', 'roster.reject', 'rule.approved', 'setting.update'];

describe('audit action labels', () => {
  it.each(['en', 'ar'] as const)('every fixture and Go action has a label in %s', (locale) => {
    const leaves = messageLeaves(loadMessages(locale, 'admin.audit_log'));
    const missing = [...new Set([...goActions(), ...fixtureActions])].filter((action) => typeof leaves[keyOf(action)] !== 'string' || leaves[keyOf(action)] === '');
    expect(missing).toEqual([]);
  });

  it('has the same actions in English and Arabic', () => {
    const keys = (locale: 'en' | 'ar') => Object.keys(messageLeaves(loadMessages(locale, 'admin.audit_log'))).filter((key) => key.startsWith('admin.audit_log.act.')).sort();
    expect(keys('ar')).toEqual(keys('en'));
  });
});
