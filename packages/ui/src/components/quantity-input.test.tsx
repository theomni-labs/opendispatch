// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuantityInput } from './quantity-input';

afterEach(cleanup);

describe('QuantityInput', () => {
  it('is a spinbutton that commits typing on blur, within min and max', () => {
    const onChange = vi.fn();
    render(<QuantityInput aria-label="Notice" defaultValue={7} min={1} max={30} uom="days" onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'Notice' }) as HTMLInputElement;
    expect(input.value).toBe('7');
    expect(input.getAttribute('aria-valuetext')).toBe('7 days');
    fireEvent.change(input, { target: { value: '10' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(10);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(input.value).toBe('30');
  });

  it('steps with the buttons and the arrow keys, and reads Arabic-Indic digits', () => {
    const onChange = vi.fn();
    render(<QuantityInput aria-label="Count" defaultValue={2} min={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    const input = screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.change(input, { target: { value: '١٢' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it('disables decrease at the minimum', () => {
    render(<QuantityInput aria-label="Count" value={0} min={0} />);
    expect((screen.getByRole('button', { name: 'Decrease' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
