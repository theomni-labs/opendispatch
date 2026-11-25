// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDrop } from './file-drop';

afterEach(cleanup);

const file = (name: string, size: number, type = 'text/csv') => new File([new Uint8Array(size)], name, { type });

describe('FileDrop', () => {
  it('lists accepted files with a remove button, and explains refused ones in an alert', () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDrop accept=".csv" maxSize={2048} multiple hint="CSV, up to 2 KB" onFiles={onFiles} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('.csv');
    fireEvent.change(input, { target: { files: [file('zones.csv', 1500), file('photo.png', 10, 'image/png'), file('big.csv', 4096)] } });
    expect(onFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'zones.csv' })]);
    expect(screen.getByRole('list', { name: 'Selected files' }).textContent).toContain('1.5 KB');
    expect(screen.getByRole('alert').textContent).toBe('photo.png is not an accepted file type.big.csv is larger than 2 KB.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove zones.csv' }));
    expect(onFiles).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
