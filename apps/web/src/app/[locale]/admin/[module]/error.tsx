'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useParams } from 'next/navigation';
import { useTransition } from 'react';
import { RetryButton } from '@/components/opendispatch/RetryButton';
import { ScreenError } from '@/components/opendispatch/ScreenError';
import { findModuleBySlug } from '@/i18n/module-routes';
import { useRouter } from '@/i18n/navigation';

// The error boundary of an Admin module page: the module's own line ("Users could not load.") or the generic one, and a
// retry, with no stack trace and no message text. The shell stays (this boundary sits inside the layout). Retry asks the
// server for the page again and then re-renders the boundary, as Next documents for a failure that came from the server.
export default function ModuleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { module: slug } = useParams<{ module?: string }>();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const def = slug === undefined ? undefined : findModuleBySlug('admin', slug);
  return (
    <ScreenError
      moduleId={def?.id}
      compact
      retry={
        <RetryButton
          onRetry={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        />
      }
    />
  );
}
