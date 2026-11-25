// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import { SignInPage } from '@/components/opendispatch/SignInCard';
import { SignInCardMessage } from '@/components/opendispatch/SignInCardMessage';

// A sign-in message. It takes no parameter and reads no session: a person who was just turned away has none.
export default async function SignInMessageRefused({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <SignInPage>
      <SignInCardMessage kind="refused" />
    </SignInPage>
  );
}
