// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '../test-utils';
import { ConfirmDialog } from './ConfirmDialog';
import { ReasonDialog } from './ReasonDialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  const dialog = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => (
    <ConfirmDialog open onClose={() => undefined} onConfirm={() => undefined} title="Disable Nadia?" description="They cannot sign in. History stays." confirmLabel="Disable user" {...props} />
  );

  it('is a dialog with a title, a description, Cancel and the confirm button', () => {
    inLocale('en', dialog());
    expect(screen.getByRole('dialog', { name: 'Disable Nadia?' })).toBeTruthy();
    expect(screen.getByText('They cannot sign in. History stays.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable user' })).toBeTruthy();
  });

  it('confirms and cancels through the callbacks, and closes on Escape', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    inLocale('en', dialog({ onClose, onConfirm }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable user' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('puts the focus on Cancel first, so the safe answer is one Enter away', () => {
    inLocale('en', dialog({ tone: 'danger' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('shows the pending state on the confirm button and blocks a second click', () => {
    const onConfirm = vi.fn();
    inLocale('en', dialog({ pending: true, onConfirm }));
    const confirm = screen.getByRole('button', { name: /Disable user/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows an error inside the dialog', () => {
    inLocale('en', dialog({ error: <p role="alert">The last active Administrator cannot be disabled.</p> }));
    expect(screen.getByRole('alert').textContent).toContain('last active Administrator');
  });

  it('renders nothing when closed', () => {
    inLocale('en', dialog({ open: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says Cancel in Arabic and takes a cancel label from the caller', () => {
    inLocale('ar', dialog({ title: 'تعطيل نادية؟', description: 'لن يتمكن من الدخول.', confirmLabel: 'تعطيل المستخدم' }));
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeTruthy();
    expect(hasLatinLetters(readableText(screen.getByRole('dialog')))).toBe(false);
    cleanup();
    inLocale('en', dialog({ cancelLabel: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
  });
});

describe('ReasonDialog', () => {
  const dialog = (props: Partial<Parameters<typeof ReasonDialog>[0]> = {}) => (
    <ReasonDialog open onClose={() => undefined} onConfirm={() => undefined} title="Pause the model" confirmLabel="Pause" minLength={10} {...props} />
  );
  const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
  const confirm = () => screen.getByRole('button', { name: 'Pause' });

  it('keeps the confirm button unavailable, with the reason why, until the note is long enough', () => {
    const onConfirm = vi.fn();
    inLocale('en', dialog({ onConfirm }));
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Write at least 10 characters.').length).toBeGreaterThan(0);
    fireEvent.change(box(), { target: { value: 'too short' } });
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(box(), { target: { value: 'the feed is down' } });
    expect(confirm().hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText('Write at least 10 characters.')).toBeNull();
  });

  it('counts the trimmed note, and gives onConfirm the trimmed text', () => {
    const onConfirm = vi.fn();
    inLocale('en', dialog({ onConfirm }));
    fireEvent.change(box(), { target: { value: '     abc     ' } });
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(box(), { target: { value: '   the feed is down   ' } });
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith('the feed is down');
  });

  it('says "1 character" for a minimum of one, and uses the Arabic plural forms', () => {
    inLocale('en', dialog({ minLength: 1 }));
    expect(screen.getAllByText('Write at least 1 character.').length).toBeGreaterThan(0);
    cleanup();
    for (const [min, phrase] of [[1, 'حرفًا واحدًا'], [2, 'حرفين'], [5, '5 أحرف'], [11, '11 حرفًا'], [100, '100 حرف']] as const) {
      cleanup();
      inLocale('ar', dialog({ minLength: min, confirmLabel: 'إيقاف', title: 'إيقاف النموذج' }));
      expect(screen.getAllByText(new RegExp(phrase)).length).toBeGreaterThan(0);
    }
  });

  it('starts empty each time it opens', () => {
    const { rerender } = inLocale('en', dialog());
    fireEvent.change(box(), { target: { value: 'a long enough note' } });
    rerender(dialog({ open: false }));
    rerender(dialog());
    expect(box().value).toBe('');
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
  });

  it('puts the focus in the note box, and limits its length', () => {
    inLocale('en', dialog({ maxLength: 40 }));
    expect(document.activeElement).toBe(box());
    expect(box().maxLength).toBe(40);
  });

  it('is danger-coloured on request, shows pending and an error, and Cancel closes it', () => {
    const onClose = vi.fn();
    inLocale('en', dialog({ tone: 'danger', pending: true, onClose, error: <p role="alert">It changed meanwhile.</p> }));
    expect(screen.getByRole('alert').textContent).toContain('It changed meanwhile.');
    expect(screen.getByRole('button', { name: /Pause/ }).getAttribute('aria-busy')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('labels the box "Reason" and the Arabic one "السبب"', () => {
    inLocale('en', dialog());
    expect(screen.getByLabelText(/Reason/)).toBe(box());
    cleanup();
    inLocale('ar', dialog({ confirmLabel: 'إيقاف', title: 'إيقاف النموذج' }));
    expect(screen.getByLabelText(/السبب/)).toBe(box());
    expect(hasLatinLetters(readableText(screen.getByRole('dialog')))).toBe(false);
  });
});
