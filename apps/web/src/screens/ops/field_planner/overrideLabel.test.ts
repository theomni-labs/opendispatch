// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { overrideChangeLabel } from './overrideLabel';

const names: Record<string, string> = { a: 'Adel Al-Qadami', b: 'Basma Al-Harbi' };
const nameOf = (id: string) => names[id] ?? null;

describe('overrideChangeLabel', () => {
  it('keeps the from-name after approval, when the line already holds the new agent', () => {
    const approved = { change_type: 'replace_agent' as const, before: { agent_id: 'a' }, after: { agent_id: 'b' } };
    expect(overrideChangeLabel(approved, 'Basma Al-Harbi', nameOf)).toBe('Adel Al-Qadami → Basma Al-Harbi');
  });

  it('names the added agent, and the removed one from before', () => {
    expect(overrideChangeLabel({ change_type: 'add_assignment', before: null, after: { agent_id: 'b' } }, null, nameOf)).toBe('Basma Al-Harbi');
    expect(overrideChangeLabel({ change_type: 'remove_assignment', before: { agent_id: 'a' }, after: null }, null, nameOf)).toBe('Adel Al-Qadami');
  });

  it('falls back to the line, then a dash', () => {
    expect(overrideChangeLabel({ change_type: 'change_vehicle', before: { vehicle_id: 'v' }, after: { vehicle_id: 'w' } }, 'Adel Al-Qadami', nameOf)).toBe('Adel Al-Qadami');
    expect(overrideChangeLabel({ change_type: 'change_shift', before: null, after: null }, null, nameOf)).toBe('—');
  });
});
