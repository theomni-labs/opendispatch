// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import { SignInPage } from '@/components/opendispatch/SignInCard';
import { SignInCardMessage, referenceFrom } from '@/components/opendispatch/SignInCardMessage';

// "Something went wrong", with the reference code to share with support: `?ref=ODP-XXXXXXXX`. A reference
// code is not a secret. Anything else in `ref` is ignored and never shown.
export default async function SignInMessageError({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ ref?: string | string[] }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { ref } = await searchParams;
  return (
    <SignInPage>
      <SignInCardMessage kind="error" reference={referenceFrom(ref)} />
    </SignInPage>
  );
}
