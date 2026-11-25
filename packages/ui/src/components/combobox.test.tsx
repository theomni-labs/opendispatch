// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Combobox } from './combobox';

afterEach(cleanup);

describe('Combobox', () => {
  it('is a combobox input carrying its name and id, showing the chosen label', () => {
    render(
      <Combobox
        id="agent"
        aria-label="Agent"
        value="a2"
        options={[
          { value: 'a1', label: 'Lina Haddad', description: 'North', meta: '2 jobs' },
          { value: 'a2', label: 'Omar Aziz' },
        ]}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Agent' });
    expect(input.id).toBe('agent');
    expect(screen.getByText('Omar Aziz')).toBeTruthy();
  });
});
