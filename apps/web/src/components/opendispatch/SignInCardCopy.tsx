'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, useToast } from '@opendispatch/ui';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The Copy button next to a reference code. The code is not a secret: it is
 * in the address of the page. When the browser cannot copy (an insecure address, a refusal) nothing is claimed: no toast.
 */
export function SignInCardCopy({ value }: { value: string }) {
  const t = useTranslations('signIn');
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      startIcon={<Copy />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast({ title: t('copied'), tone: 'info' });
        } catch {
          // Copying is a convenience: the code stays on the page to be read out or selected.
        }
      }}
    >
      {t('copy')}
    </Button>
  );
}
