// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { leaves, syncStatus } from './status.mjs';
import { counts, reviewSheet, sheetRows } from './review-sheet';

// The status sync and the review sheet, against small message files in a temp folder (never the real messages).
let root: string;

const write = (rel: string, value: unknown) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), JSON.stringify(value));
};
const json = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'opendispatch-i18n-'));
  write('apps/web/messages/en.json', { common: { more: 'More', close: 'Close' } });
  write('apps/web/messages/ar.json', { common: { more: 'المزيد', close: 'إغلاق' } });
  write('apps/web/messages/admin/x_y/en.json', { tab: { one: 'One', two: 'Two' } });
  write('apps/web/messages/admin/x_y/ar.json', { tab: { one: 'واحد', two: 'اثنان' } });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('the status file and the review sheet', () => {
  it('adds new keys as draft, keeps a reviewed key, and drops the status of a key that is gone', () => {
    syncStatus(root);
    const file = path.join(root, 'apps/web/messages/ar.status.json');
    const status = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
    (status['admin.x_y'] as Record<string, string>)['tab.one'] = 'reviewed';
    (status['admin.x_y'] as Record<string, string>)['gone.key'] = 'draft';
    fs.writeFileSync(file, JSON.stringify(status));
    const ar = path.join(root, 'apps/web/messages/admin/x_y/ar.json');
    const arJson = JSON.parse(fs.readFileSync(ar, 'utf8')) as Record<string, unknown>;
    arJson['newKey'] = 'جديد';
    fs.writeFileSync(ar, JSON.stringify(arJson));
    const result = syncStatus(root);
    expect(result.added).toEqual(['admin.x_y:newKey']);
    expect(result.removed).toEqual(['admin.x_y:gone.key']);
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
    expect(after['admin.x_y']?.['tab.one']).toBe('reviewed');
    expect(after['admin.x_y']?.['newKey']).toBe('draft');
  });

  it('lists the drafts with their English and Arabic, and counts them', () => {
    syncStatus(root);
    const rows = sheetRows(root);
    const core = Object.keys(leaves(json('apps/web/messages/ar.json') as never)).length;
    expect(counts(rows)).toEqual({ draft: rows.length, reviewed: 0, byScope: { core, 'admin.x_y': rows.length - core } });
    expect(rows.find((r) => r.key === 'tab.one')).toEqual({ scope: 'admin.x_y', key: 'tab.one', english: 'One', arabic: 'واحد', status: 'draft' });
    expect(sheetRows(root, 'x_y').every((r) => r.scope === 'admin.x_y')).toBe(true);
    const csv = reviewSheet(rows);
    expect(csv.startsWith('﻿Scope,Key,English,Arabic,Status')).toBe(true);
    expect(csv).toContain('admin.x_y,tab.one,One,واحد,draft');
  });

  it('leaves reviewed keys out of the sheet unless asked, and guards a cell that looks like a formula', () => {
    const rows = [
      { scope: 'admin.x_y', key: 'a', english: '=1+1', arabic: 'أ', status: 'draft' as const },
      { scope: 'admin.x_y', key: 'b', english: 'B', arabic: 'ب', status: 'reviewed' as const },
    ];
    expect(reviewSheet(rows)).not.toContain(',b,');
    expect(reviewSheet(rows)).toContain("'=1+1");
    expect(reviewSheet(rows, true)).toContain(',b,B,ب,reviewed');
  });
});
