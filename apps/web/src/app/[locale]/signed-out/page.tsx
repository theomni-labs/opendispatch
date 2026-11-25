// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import { SignInPage } from '@/components/opendispatch/SignInCard';
import { SignInCardSignedOut } from '@/components/opendispatch/SignInCardSignedOut';

// Where signing out lands. It reads no session: the sign-out action has already recorded
// `auth.sign_out` and cleared the cookie.
export default async function SignedOut({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <SignInPage>
      <SignInCardSignedOut />
    </SignInPage>
  );
}
