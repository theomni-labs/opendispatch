// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionErrorCode, ActionResult } from '@/lib/actions/types';
import { hasLatinLetters, inLocale, readableText } from '../test-utils';
import { ActionError } from './ActionError';
import { useAdminAction, type UseAdminActionOptions } from './useAdminAction';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/users-roles', useRouter: () => router }));

afterEach(() => {
  cleanup();
  router.replace.mockReset();
});

type Named = { readonly name: string };

function Harness({ action, options }: { action: (input: Named) => Promise<ActionResult<Named>>; options?: UseAdminActionOptions<Named> }) {
  const invite = useAdminAction(action, options);
  return (
    <div>
      <button type="button" onClick={() => invite.run({ name: 'Sara' })}>
        run
      </button>
      <span data-testid="pending">{String(invite.pending)}</span>
      <ActionError error={invite.error} onDismiss={invite.reset} />
    </div>
  );
}

const fail = (code: ActionErrorCode, message = 'detail from the server', reference?: string): ActionResult<Named> => ({ ok: false, code, message, ...(reference === undefined ? {} : { reference }) });
const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
  });
};

describe('useAdminAction: success', () => {
  it('runs the action with the arguments, then shows a toast with the caller\'s translated line and calls onSuccess', async () => {
    const action = vi.fn(async (input: Named): Promise<ActionResult<Named>> => ({ ok: true, data: input }));
    const onSuccess = vi.fn();
    inLocale('en', <Harness action={action} options={{ successTitle: 'Invitation sent', successDescription: (user) => `For ${user.name}`, onSuccess }} />);
    await click();
    expect(action).toHaveBeenCalledWith({ name: 'Sara' });
    await waitFor(() => expect(screen.getByText('Invitation sent')).toBeTruthy());
    expect(screen.getByText('For Sara')).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledWith({ name: 'Sara' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says "Saved" (or the Arabic) when the caller gives no title', async () => {
    inLocale('en', <Harness action={async (input) => ({ ok: true, data: input })} />);
    await click();
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    cleanup();
    inLocale('ar', <Harness action={async (input) => ({ ok: true, data: input })} />);
    await click();
    await waitFor(() => expect(screen.getByText('تم الحفظ')).toBeTruthy());
  });

  it('can stay quiet', async () => {
    const onSuccess = vi.fn();
    inLocale('en', <Harness action={async (input) => ({ ok: true, data: input })} options={{ quiet: true, onSuccess }} />);
    await click();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('is pending while the action runs, and ignores a second click meanwhile', async () => {
    let release: (result: ActionResult<Named>) => void = () => undefined;
    const action = vi.fn(() => new Promise<ActionResult<Named>>((resolve) => (release = resolve)));
    inLocale('en', <Harness action={action} />);
    await click();
    expect(screen.getByTestId('pending').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true, data: { name: 'x' } }));
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('false'));
    await click();
    expect(action).toHaveBeenCalledTimes(2);
  });
});

describe('useAdminAction: failure', () => {
  it.each([
    ['forbidden', 'Your role cannot do that.', 'دورك لا يتيح لك ذلك.'],
    ['not_found', 'That record no longer exists.', 'هذا السجل لم يعد موجودًا.'],
    ['invalid', 'Check the details and try again.', 'راجع البيانات ثم حاول مرة أخرى.'],
    ['conflict', 'That is not possible in its current state.', 'لا يمكن ذلك في حالته الحالية.'],
    ['unauthenticated', 'Your session has ended. Sign in again.', 'انتهت جلستك. سجّل الدخول من جديد.'],
  ] as const)('%s: an inline alert with a translated line, then the English detail marked lang="en" dir="ltr"', async (code, en, ar) => {
    for (const [locale, line] of [['en', en], ['ar', ar]] as const) {
      cleanup();
      inLocale(locale, <Harness action={async () => fail(code, 'The last active Administrator cannot be disabled.')} />);
      await click();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(line);
      const detail = alert.querySelector('[lang="en"]');
      expect(detail?.textContent).toBe('The last active Administrator cannot be disabled.');
      expect(detail?.getAttribute('dir')).toBe('ltr');
      expect(detail?.getAttribute('translate')).toBe('no');
    }
  });

  it('shows a reference code for an unexpected error, with no server detail', async () => {
    inLocale('en', <Harness action={async () => fail('unexpected', 'Something went wrong.', 'ODP-9B41C7E0')} />);
    await click();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something went wrong on our side.');
    expect(alert.textContent).toContain('Reference ODP-9B41C7E0');
    expect(alert.querySelector('[lang="en"]')).toBeNull();
  });

  it('treats a call that throws (network, a body over the limit) as the client-only code "network"', async () => {
    inLocale('en', <Harness action={async () => Promise.reject(new Error('Failed to fetch'))} />);
    await click();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The server could not be reached. Try again.');
    expect(alert.textContent).not.toContain('Failed to fetch');
  });

  it('treats an answer that is not an ActionResult as a network failure, not a success', async () => {
    const onSuccess = vi.fn();
    inLocale('en', <Harness action={async () => undefined as unknown as ActionResult<Named>} options={{ onSuccess }} />);
    await click();
    await screen.findByRole('alert');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('sends `unauthenticated` to the start page', async () => {
    inLocale('en', <Harness action={async () => fail('unauthenticated', 'No signed-in session.')} />);
    await click();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('does not navigate for other failures', async () => {
    inLocale('en', <Harness action={async () => fail('forbidden')} />);
    await click();
    await screen.findByRole('alert');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('calls onFailure, and can show the failure as a toast instead of leaving it inline', async () => {
    const onFailure = vi.fn();
    inLocale('en', <Harness action={async () => fail('conflict', 'It changed.')} options={{ onFailure, failureToast: true }} />);
    await click();
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith({ code: 'conflict', message: 'It changed.', reference: undefined }));
    expect(screen.getAllByText('That is not possible in its current state.').length).toBeGreaterThan(0);
  });

  it('clears the error on dismiss and when the next run starts', async () => {
    let calls = 0;
    inLocale('en', <Harness action={async (input) => (++calls === 1 ? fail('invalid') : { ok: true, data: input })} />);
    await click();
    await screen.findByRole('alert');
    await click();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('dismisses the alert with its close button', async () => {
    inLocale('en', <Harness action={async () => fail('invalid')} />);
    await click();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ActionError: a known reason code', () => {
  const storage = 'Import: the file storage is not available. Ask the system administrator to check it.';
  it.each([
    ['en', 'File storage is not available. Ask the system administrator to check it.', 'Details'],
    ['ar', 'تخزين الملفات غير متاح. اطلب من مسؤول النظام التحقق منه.', 'التفاصيل'],
  ] as const)('%s: a translated reason, the English detail behind Details', async (locale, line, details) => {
    inLocale(locale, <Harness action={async () => ({ ok: false, code: 'conflict', message: storage, reason: 'STORAGE_UNAVAILABLE' })} />);
    await click();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(line);
    const fold = alert.querySelector('details');
    expect(fold?.querySelector('summary')?.textContent).toBe(details);
    expect(fold?.querySelector('[lang="en"]')?.textContent).toBe(storage);
    if (locale === 'ar') expect(hasLatinLetters(readableText(alert).replace(storage, ''))).toBe(false);
  });

  it('an unknown reason keeps the plain detail', async () => {
    inLocale('en', <Harness action={async () => ({ ok: false, code: 'conflict', message: 'It changed.', reason: 'SOMETHING_ELSE' })} />);
    await click();
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('details')).toBeNull();
    expect(alert.querySelector('[lang="en"]')?.textContent).toBe('It changed.');
  });
});

describe('ActionError in Arabic', () => {
  it('has no untranslated English outside the marked detail', async () => {
    const { container } = inLocale('ar', <Harness action={async () => fail('forbidden', 'administrator may not edit admin.users_roles.')} />);
    await click();
    const alert = await screen.findByRole('alert');
    expect(hasLatinLetters(readableText(alert).replace('administrator may not edit admin.users_roles.', ''))).toBe(false);
    expect(container.querySelector('[lang="en"][dir="ltr"]')).not.toBeNull();
  });
});
