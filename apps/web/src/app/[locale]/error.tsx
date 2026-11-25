'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button } from '@opendispatch/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ErrorPanel } from '@/components/opendispatch/ModuleStates';
import styles from './page.module.css';

// Error boundary of the locale layout: errors thrown by a layout (for example the shell) end up here. Red state with a
// retry action; no stack trace and no message text.
export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  return (
    <main className={styles.page}>
      <div className={styles.narrow}>
        <ErrorPanel
          retry={
            <Button variant="primary" startIcon={<RefreshCw />} onClick={reset}>
              {t('retry')}
            </Button>
          }
        />
      </div>
    </main>
  );
}
