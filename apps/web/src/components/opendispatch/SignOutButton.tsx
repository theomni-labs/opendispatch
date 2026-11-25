'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { signOutDemo } from '@/lib/demo/actions';

export function SignOutButton() {
  const t = useTranslations('common');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() => {
        startTransition(async () => {
          await signOutDemo(locale);
        });
      }}
    >
      {t('signOut')}
    </Button>
  );
}
