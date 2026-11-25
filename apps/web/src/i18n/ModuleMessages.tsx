'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl';
import { type ReactNode, useMemo } from 'react';
import { type Messages, mergeMessages } from './message-tree';

/**
 * Adds one module's messages to the ones the root layout already gave the client (core only), for everything below it.
 * The module layout (`app/[locale]/admin/[module]/layout.tsx`) renders it with `messages` = that module's slice
 * (`{ admin: { <module>: ... } }`, from `moduleMessages`), so the browser receives core once and the module once, and a
 * module screen can never read another module's keys.
 *
 * A nested provider replaces the messages of the one above it but inherits everything else (formats, time zone, error
 * handling), so only `locale` and the merged tree are given here.
 */
export function ModuleMessages({ messages, children }: { messages: Messages; children: ReactNode }) {
  const locale = useLocale();
  const parent = useMessages() as Messages;
  const merged = useMemo(() => mergeMessages(parent, messages), [parent, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}
