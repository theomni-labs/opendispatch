'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Retry for the ?state=error review page: reloads the page without the state parameter. The real error boundary
 * (error.tsx) gives `onRetry`, which asks the server again and resets the boundary; the button then does only that.
 */
export function RetryButton({ onRetry }: { onRetry?: () => void } = {}) {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Button
      variant="primary"
      startIcon={<RefreshCw />}
      onClick={() => {
        if (onRetry !== undefined) {
          onRetry();
          return;
        }
        router.replace(pathname);
        router.refresh();
      }}
    >
      {t('retry')}
    </Button>
  );
}
