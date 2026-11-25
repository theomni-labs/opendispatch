'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ErrorPanel } from '@/components/opendispatch/ModuleStates';

// The error boundary of a ops module page: red state with a retry action, no stack trace and no message text. The
// shell stays (this boundary sits inside the layout). `reset` re-renders the page.
export default function ModuleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  return (
    <ErrorPanel
      retry={
        <Button variant="primary" startIcon={<RefreshCw />} onClick={reset}>
          {t('retry')}
        </Button>
      }
    />
  );
}
