// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox, RadioGroup, Switch } from './choice';

afterEach(cleanup);

describe('Checkbox', () => {
  it('is a native checkbox named by its label, described by its description, and submits with a form', () => {
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <Checkbox name="agree" value="yes" label="I agree" description="Read the terms" defaultChecked onChange={onChange} />
      </form>,
    );
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Read the terms');
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('agree')).toBe('yes');
    fireEvent.click(box);
    expect(onChange.mock.calls[0]?.[0].target.checked).toBe(false);
  });

  it('reports mixed when indeterminate', () => {
    render(<Checkbox aria-label="All" indeterminate />);
    expect(screen.getByRole('checkbox', { name: 'All' }).getAttribute('aria-checked')).toBe('mixed');
  });
});

describe('RadioGroup', () => {
  it('is a named radiogroup of native radios that share the name', () => {
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <RadioGroup
          name="reason"
          aria-label="Reason"
          defaultValue="a"
          onChange={onChange}
          options={[
            { value: 'a', label: 'Field preferred', description: 'Closer to the site' },
            { value: 'b', label: 'Remote' },
          ]}
        />
      </form>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Reason' });
    expect(group).toBeTruthy();
    const first = screen.getByRole('radio', { name: 'Field preferred' }) as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(document.getElementById(first.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Closer to the site');
    fireEvent.click(screen.getByRole('radio', { name: 'Remote' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('reason')).toBe('b');
  });
});

describe('Switch', () => {
  it('is a role="switch" button named by its label, with aria-checked', () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Show Hijri dates" description="Beside each date" onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole('switch', { name: 'Show Hijri dates' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Beside each date');
  });

  it('follows a controlled value and can be disabled', () => {
    render(<Switch aria-label="Feed" checked disabled />);
    const toggle = screen.getByRole('switch', { name: 'Feed' }) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.disabled).toBe(true);
  });
});
