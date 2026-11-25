// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider';
import { Drawer } from './drawer';

afterEach(cleanup);

describe('Drawer', () => {
  it('is a modal dialog named by its title, described by its subtitle, with a footer', () => {
    render(
      <Drawer open onClose={() => undefined} title="Override" subtitle="Case 12" footer={<button type="button">Save</button>}>
        <input aria-label="Agent" />
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Override' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Case 12').id);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Agent' }));
  });

  it('can focus the close button first', () => {
    render(
      <Drawer open onClose={() => undefined} title="Menu" initialFocus="close">
        <a href="/a">A</a>
      </Drawer>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('renders nothing when closed and calls onClose from the close button', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Drawer open onClose={onClose} title="T" />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Drawer open={false} onClose={onClose} title="T" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the inline end: the right in English, the left in Arabic', () => {
    render(<Drawer open onClose={() => undefined} title="T" />);
    expect(document.querySelector('.ant-drawer-right')).not.toBeNull();
    cleanup();
    render(
      <DesignSystemProvider locale="ar">
        <Drawer open onClose={() => undefined} title="T" />
      </DesignSystemProvider>,
    );
    expect(document.querySelector('.ant-drawer-left')).not.toBeNull();
  });
});
