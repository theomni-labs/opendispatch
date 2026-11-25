// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateInput } from './date-input';
import { Input, Textarea } from './input';
import { Select } from './select';

afterEach(cleanup);

describe('Input and Textarea', () => {
  it('pass native attributes to the element, give the ref the element, and submit with a form', () => {
    const ref = createRef<HTMLInputElement>();
    const { container } = render(
      <form>
        <Input ref={ref} name="title" aria-label="Title" defaultValue="Night shift" invalid prefix="SAR" />
        <Textarea name="notes" aria-label="Notes" defaultValue="Bring the badge" />
      </form>,
    );
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(ref.current).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('SAR')).toBeTruthy();
    const notes = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
    expect(notes.rows).toBe(3);
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect([data.get('title'), data.get('notes')]).toEqual(['Night shift', 'Bring the badge']);
  });

  it('calls onChange with the input event', () => {
    const onChange = vi.fn();
    render(<Input aria-label="City" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Riyadh' } });
    expect(onChange.mock.calls[0]?.[0].target.value).toBe('Riyadh');
  });
});

describe('Select', () => {
  it('is a native select with a placeholder option, and changes like one', () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Day" placeholder="Choose" value="" onChange={onChange} options={[{ value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday', disabled: true }]} />,
    );
    const select = screen.getByRole('combobox', { name: 'Day' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose', 'Monday', 'Tuesday']);
    expect(select.options[2]?.disabled).toBe(true);
    fireEvent.change(select, { target: { value: '1' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('starts on the placeholder when uncontrolled and marks invalid', () => {
    render(<Select aria-label="Day" placeholder="Choose" invalid options={[{ value: '1', label: 'Monday' }]} />);
    const select = screen.getByRole('combobox', { name: 'Day' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('DateInput', () => {
  it('is a date input that marks a day out of range invalid and shows the Hijri day', () => {
    render(<DateInput aria-label="From" value="2026-09-06" min="2026-10-01" showHijri onChange={() => undefined} />);
    const input = screen.getByLabelText('From') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const caption = document.getElementById((input.getAttribute('aria-describedby') ?? '').trim());
    expect(caption?.textContent).toMatch(/^Hijri: \d+ .+ 1448 AH$/);
  });
});
