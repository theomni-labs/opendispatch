// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import { SignInPage } from '@/components/opendispatch/SignInCard';
import { SignInCardEmergency } from '@/components/opendispatch/SignInCardEmergency';
import { landingHref } from '@/components/shells/landing';
import { redirect } from '@/i18n/navigation';
import { getRequestContext } from '@/lib/data/context';

// The emergency administrator sign-in: password, then the authenticator code, in one page. The step is the
// page's own state, not part of the address, so a refresh starts again at the password. demo mode only (see /sign-in).
export default async function EmergencySignIn({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await getRequestContext();
  const home = ctx === null ? undefined : landingHref(ctx);
  if (home !== undefined) redirect({ href: home, locale });

  return (
    <SignInPage>
      <SignInCardEmergency />
    </SignInPage>
  );
}
