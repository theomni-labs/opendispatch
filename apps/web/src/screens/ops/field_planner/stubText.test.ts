// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { messageLeaves } from '@/i18n/message-tree';
import { loadMessages } from '@/i18n/messages';

const leaves = (locale: 'en' | 'ar') => messageLeaves(loadMessages(locale, 'ops.field_planner'));

describe('Rebuild with optimizer is labelled as the stub it is', () => {
  it('says it is a stub and that nothing was rebuilt, in both languages', () => {
    const en = leaves('en');
    expect(en['ops.field_planner.menu.rebuild']).toBe('Rebuild with optimizer (stub)');
    expect(en['ops.field_planner.toast.rebuild']).toBe('Rebuild is not built yet');
    expect(en['ops.field_planner.toast.rebuildDesc']).toBe('Nothing was rebuilt');
    const ar = leaves('ar');
    expect(ar['ops.field_planner.menu.rebuild']).toContain('(محاكاة)');
    expect(ar['ops.field_planner.toast.rebuildDesc']).toBe('لم يُعَد بناء أي شيء');
  });
});
