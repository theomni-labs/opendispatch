// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { messageLeaves } from '@/i18n/message-tree';
import { PRESET_NOTES, SESSION_LABEL, STEP_LABEL } from './presets';

// loadIdentityView always reads live zones now: every
// other test here moved to view.live.test.ts.
describe('the message keys the screen looks up by preset, field and step', () => {
  const en = messageLeaves(loadMessages('en', 'admin.sign_in_identity'));
  const ar = messageLeaves(loadMessages('ar', 'admin.sign_in_identity'));
  const has = (key: string) => en[`admin.sign_in_identity.${key}`] !== undefined && ar[`admin.sign_in_identity.${key}`] !== undefined;

  it('has the notes of every preset, the eight test steps and the session lengths', () => {
    for (const notes of Object.values(PRESET_NOTES)) for (const key of [...notes.warning, ...notes.hint]) expect(has(key), key).toBe(true);
    expect(Object.keys(STEP_LABEL)).toEqual(['keycloak', 'reach', 'discovery', 'client', 'claims', 'saml', 'signed', 'attrs']);
    for (const key of Object.values(STEP_LABEL)) expect(has(key), key).toBe(true);
    for (const key of Object.values(SESSION_LABEL)) expect(has(key), key).toBe(true);
  });
});
