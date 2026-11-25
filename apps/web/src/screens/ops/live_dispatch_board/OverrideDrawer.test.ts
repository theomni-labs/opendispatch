// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Review fix: the agent list sat under the drawer. The list is the Combobox's dropdown, which opens in <body> on the
// dropdown layer; the drawer and the dialogs sit on their own layers below and above it.
const tokens = fs.readFileSync(path.join(import.meta.dirname, '../../../../../../packages/ui/src/styles/tokens.css'), 'utf8');

describe('the override drawer agent list', () => {
  it('opens above the drawer, not under it', () => {
    const z = (name: string) => Number(new RegExp(`--od-${name}:\\s*(\\d+)`).exec(tokens)?.[1]);
    expect(z('z-drawer')).toBeLessThan(z('z-dropdown'));
    expect(z('z-drawer')).toBeLessThan(z('z-modal'));
  });
});
