// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenError } from './ScreenError';
import { inLocale } from './test-utils';

afterEach(cleanup);

const retry = <button type="button">retry</button>;

describe('ScreenError', () => {
  it.each([
    ['en', 'Something went wrong', 'The data could not load.'],
    ['ar', 'حدث خطأ ما', 'تعذّر تحميل البيانات.'],
  ] as const)('says what happened in one line and offers the retry it is given, in %s', (locale, title, line) => {
    inLocale(locale, <ScreenError retry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain(line);
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });

  it('falls back to the generic text for a module that writes none', () => {
    // Every module has a screen now, so the module writes nothing here by construction: an empty message object.
    inLocale('en', <ScreenError moduleId="admin.audit_log" retry={retry} />, { messages: { admin: { audit_log: {} } } });
    expect(screen.getByRole('alert').textContent).toContain('The data could not load.');
  });

  it('uses the module’s own line, and only that module’s', () => {
    const messages = { admin: { users_roles: { states: { error: { desc: 'Users could not load.' } } }, audit_log: { states: { error: { desc: 'The audit log could not load.' } } } } };
    inLocale('en', <ScreenError moduleId="admin.users_roles" retry={retry} />, { messages });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Users could not load.');
    expect(alert.textContent).not.toContain('audit log');
    expect(alert.textContent).toContain('Something went wrong'); // the title still comes from the core text
  });

  it('shows no stack trace and nothing from the thrown error: it takes no error at all', () => {
    inLocale('en', <ScreenError retry={retry} compact />);
    expect(screen.getByRole('alert').textContent).toBe('Something went wrongThe data could not load.retry');
  });
});
