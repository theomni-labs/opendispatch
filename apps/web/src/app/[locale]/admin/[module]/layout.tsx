// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ModuleMessages } from '@/i18n/ModuleMessages';
import { moduleMessages } from '@/i18n/messages';
import { findModuleBySlug } from '@/i18n/module-routes';

// An unknown slug under /admin is a 404 here, before the page (and its loading state) starts streaming, so the response
// status is 404 and not a 200 with a soft not-found. The not-found page of the admin layout is shown inside the shell.
//
// The messages of the module are added here, for the page, its loading state and its error boundary, and for nothing
// outside this segment: the shell above keeps the core messages the root layout sent.
export default async function AdminModuleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string; module: string }> }) {
  const { locale, module: slug } = await params;
  const def = findModuleBySlug('admin', slug);
  if (def === undefined) notFound();
  return <ModuleMessages messages={moduleMessages(locale, def.id)}>{children}</ModuleMessages>;
}
