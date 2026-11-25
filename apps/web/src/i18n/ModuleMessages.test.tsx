// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useMessages, useTranslations } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import type { Messages } from './message-tree';
import { ModuleMessages } from './ModuleMessages';
import { coreMessages, moduleMessages, sliceOf } from './messages';

afterEach(cleanup);

// Two modules with text, standing in for the message files the module agents will write.
const modules: Record<string, Messages> = {
  users_roles: { invite: 'Invite user', states: { error: { desc: 'Users could not load.' } } },
  audit_log: { export: 'Export log' },
};

function Probe() {
  const messages = useMessages() as Messages;
  const common = useTranslations('common');
  const own = useTranslations('admin.users_roles');
  return (
    <div>
      <output data-testid="core">{common('retry')}</output>
      <output data-testid="own">{own('invite')}</output>
      <output data-testid="fallback">{own.has('missing') ? 'has' : 'none'}</output>
      <output data-testid="admin-keys">{Object.keys((messages['admin'] as Messages | undefined) ?? {}).join(',')}</output>
      <output data-testid="top-keys">{Object.keys(messages).sort().join(',')}</output>
    </div>
  );
}

// What the browser builds: the root layout's provider with core, and the module layout's ModuleMessages with the slice.
function page(locale: 'en' | 'ar', slice: Messages) {
  return render(
    <NextIntlClientProvider locale={locale} messages={coreMessages(locale)}>
      <ModuleMessages messages={slice}>
        <Probe />
      </ModuleMessages>
    </NextIntlClientProvider>,
  );
}

describe('ModuleMessages', () => {
  it('lays one module over the core messages the page already has', () => {
    page('en', sliceOf(modules, 'admin.users_roles'));
    expect(screen.getByTestId('core').textContent).toBe('Try again');
    expect(screen.getByTestId('own').textContent).toBe('Invite user');
    expect(screen.getByTestId('admin-keys').textContent).toBe('users_roles');
    expect(screen.getByTestId('top-keys').textContent).toBe(Object.keys(coreMessages('en')).concat('admin').sort().join(','));
  });

  it('carries no other module’s keys to the browser', () => {
    page('en', sliceOf(modules, 'admin.users_roles'));
    expect(screen.getByTestId('admin-keys').textContent).not.toContain('audit_log');
    expect(document.body.innerHTML).not.toContain('Export log');
  });

  it('keeps the language of the page: Arabic core text under an Arabic module', () => {
    page('ar', sliceOf({ users_roles: { invite: 'دعوة مستخدم' } }, 'admin.users_roles'));
    expect(screen.getByTestId('core').textContent).toBe('إعادة المحاولة');
    expect(screen.getByTestId('own').textContent).toBe('دعوة مستخدم');
  });

  it('adds nothing for a module with no messages (an Ops module, an unknown id): the page keeps core only', () => {
    page('en', moduleMessages('en', 'ops.productivity_metrics'));
    expect(screen.getByTestId('admin-keys').textContent).toBe('');
    expect(screen.getByTestId('core').textContent).toBe('Try again');
  });

  it('gives a real module, whose file is still empty, its namespace, so a screen can ask for its keys', () => {
    page('en', moduleMessages('en', 'admin.updates'));
    expect(screen.getByTestId('admin-keys').textContent).toBe('updates');
    expect(screen.getByTestId('fallback').textContent).toBe('none');
  });
});
