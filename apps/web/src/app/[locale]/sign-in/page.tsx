// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import { SignInPage } from '@/components/opendispatch/SignInCard';
import { SignInCardForm } from '@/components/opendispatch/SignInCardForm';
import { SignInCardOidc } from '@/components/opendispatch/SignInCardOidc';
import { landingHref } from '@/components/shells/landing';
import { redirect } from '@/i18n/navigation';
import { getRequestContext, isOidcMode } from '@/lib/data/context';

// The sign-in page: one centred card on a bare page. Someone who already has a session goes
// to their landing page, as on the demo start page. The install mode and the customer are read on the server by the sign-in
// action (getPreSessionContext), never sent from here.
//
// PHASE A ONLY: these pages exist to show and test the sign-in flow. The real front door is Keycloak (oidc mode).
export default async function SignIn({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await getRequestContext();
  const home = ctx === null ? undefined : landingHref(ctx);
  if (home !== undefined) redirect({ href: home, locale });

  return (
    <SignInPage>
      {isOidcMode() ? <SignInCardOidc /> : <SignInCardForm />}
    </SignInPage>
  );
}
