// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../provider';
import { Modal } from './modal';

afterEach(cleanup);

function Harness({ onClose = () => undefined, description }: { onClose?: () => void; description?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        title="Delete rule"
        {...(description ? { description } : {})}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        footer={<button type="button">Delete</button>}
      >
        <input aria-label="Reason" data-autofocus="" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is a modal dialog named by its title, with its description and footer', () => {
    render(<Harness description="This cannot be undone." />);
    const dialog = screen.getByRole('dialog', { name: 'Delete rule' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Delete rule' })).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('This cannot be undone.').id);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('moves focus to the marked control', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Reason' }));
  });

  it('closes from the labelled close button and is gone from the page', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reason' }), { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('takes the close label from the provider', () => {
    render(
      <DesignSystemProvider locale="ar" labels={{ 'modal.close': 'إغلاق' }}>
        <Harness />
      </DesignSystemProvider>,
    );
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeTruthy();
  });
});
