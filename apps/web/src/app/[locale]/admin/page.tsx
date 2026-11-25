// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import { consoleLandingHref } from '@/components/shells/landing';
import { redirect } from '@/i18n/navigation';
import { getRequestContext } from '@/lib/data/context';

// /{locale}/admin leads to the role's landing module. The layout has already shown no-access to a role with
// nothing in this console, so a missing landing here means the session went away: back to the demo start page.
export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await getRequestContext();
  const href = ctx === null ? undefined : consoleLandingHref(ctx, 'admin');
  redirect({ href: href ?? '/', locale });
}
