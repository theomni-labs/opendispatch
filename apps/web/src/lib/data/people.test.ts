// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { resetDemoData } from './demo';
import { ConflictError, ForbiddenError, InvalidInputError } from './errors';
import { addSkill } from './people';
import { getSkillVocabulary } from './settings';
import { auditCount, ctxFor, dataSnapshot, expectValid, withTempDemoState } from './test-support';

withTempDemoState();

const admin = () => ctxFor('administrator');

// ---------------------------------------------------------------------------------------------
// DG7: add a skill to the vocabulary (settings-store only: no live api needed, see people.live.test.ts
// for setAgentSkills against a real agent)
// ---------------------------------------------------------------------------------------------

describe('addSkill (DG7)', () => {
  const OTHERS = ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const;

  it('adds a skill to the vocabulary, returns it, keeps the others, and audits it', async () => {
    const ctx = admin();
    const before = await getSkillVocabulary(ctx);
    const skill = await addSkill(ctx, { code: 'night_recovery', name_en: 'Night recovery', name_ar: 'الإنقاذ الليلي' });
    expectValid('SkillVocabularyEntry', skill);
    expect(skill).toEqual({ code: 'night_recovery', name_en: 'Night recovery', name_ar: 'الإنقاذ الليلي' });
    expect(await getSkillVocabulary(ctx)).toEqual([...before, skill]);
    expect(await getSkillVocabulary(ctxFor('planner'))).toContainEqual(skill); // every role reads the vocabulary
    const event = (await listAuditEvents(ctx, { action: 'skill.added' })).items[0]!;
    expect(event).toMatchObject({ outcome: 'success', entity_type: 'skill', entity_id: 'night_recovery', actor_user_id: ctx.userId });
  });

  it('takes an Arabic name that is left out or null (Arabic names are empty in the fixtures)', async () => {
    const ctx = admin();
    expect((await addSkill(ctx, { code: 'first_aid', name_en: 'First aid' })).name_ar).toBeNull();
    expect((await addSkill(ctx, { code: 'first_aid_two', name_en: 'First aid two', name_ar: null })).name_ar).toBeNull();
  });

  it('keeps the code unique, without regard to case, and shaped like the fixture codes', async () => {
    const ctx = admin();
    const existing = (await getSkillVocabulary(ctx))[0]!;
    await expect(addSkill(ctx, { code: existing.code, name_en: 'Again' })).rejects.toThrow(ConflictError);
    await addSkill(ctx, { code: 'rope_rescue', name_en: 'Rope rescue' });
    await expect(addSkill(ctx, { code: 'rope_rescue', name_en: 'Rope rescue 2' })).rejects.toThrow(ConflictError);
    for (const code of ['Rope', '1skill', 'has space', 'has-dash', '', 'a'.repeat(65), '__proto__', 'ünï', 7, null, undefined]) {
      await expect(addSkill(ctx, { code, name_en: 'X' }), String(code)).rejects.toThrow(InvalidInputError);
    }
    expect((await getSkillVocabulary(ctx)).filter((s) => s.code === 'rope_rescue')).toHaveLength(1);
  });

  it('checks the names and refuses any other field', async () => {
    const ctx = admin();
    for (const bad of [{ code: 'ok_code', name_en: '' }, { code: 'ok_code', name_en: 'a'.repeat(121) }, { code: 'ok_code' }, { code: 'ok_code', name_en: 'X', name_ar: 'a'.repeat(121) }, { code: 'ok_code', name_en: 'X', role: 'planner' }, { code: 'ok_code', name_en: 5 }, null, 'skill']) {
      await expect(addSkill(ctx, bad), JSON.stringify(bad)).rejects.toThrow(InvalidInputError);
    }
    expect((await listAuditEvents(ctx, { action: 'skill.added' })).items).toEqual([]);
  });

  it('is the Administrator only, in every install mode: every other role is forbidden, the denial is audited, and nothing changes', async () => {
    for (const role of OTHERS) {
      const before = dataSnapshot();
      const audits = await auditCount();
      await expect(addSkill(ctxFor(role), { code: 'x_skill', name_en: 'X' }), role).rejects.toThrow(ForbiddenError);
      expect(dataSnapshot()).toBe(before);
      expect(await auditCount()).toBe(audits + 1);
    }
    await expect(addSkill(ctxFor('planner'), 'nonsense')).rejects.toThrow(ForbiddenError); // the role check comes first
    for (const installMode of ['dedicated', 'shared'] as const) expect((await addSkill(ctxFor('administrator', { installMode }), { code: `skill_${installMode}`, name_en: 'X' })).code).toBe(`skill_${installMode}`);
  });

  it('resets with the demo data', async () => {
    const ctx = admin();
    await addSkill(ctx, { code: 'temp_skill', name_en: 'Temp' });
    await resetDemoData(ctx);
    await fetch(`${process.env['OPENDISPATCH_API_URL']}/_internal/test/reset`, { method: 'POST' });
    expect((await getSkillVocabulary(ctx)).map((s) => s.code)).not.toContain('temp_skill');
  });
});
