// SPDX-License-Identifier: AGPL-3.0-only
import { Card, EmptyState } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ModuleId } from '@/lib/access';
import { stateText } from './screen-text';

export interface ScreenErrorProps {
  /** The module whose own error line to use (`admin.<module>.states.error.*`); the generic line without it. */
  moduleId?: ModuleId | undefined;
  /** The retry control: `<RetryButton />` for the ?state=error review, or one that resets the error boundary. */
  retry: ReactNode;
  /** The tighter spacing of a state inside a screen (the mockups' empty compact). */
  compact?: boolean;
}

/**
 * The error state of a screen: what happened in one line and one way out, announced to screen readers (the danger
 * tone). The module's own text ("Users could not load.") comes from its message file, else the generic core text; no
 * stack trace and no message from the thrown error. Server or Client Component.
 */
export function ScreenError({ moduleId, retry, compact = false }: ScreenErrorProps) {
  const t = useTranslations();
  return (
    <Card padding="none">
      <EmptyState
        tone="danger"
        compact={compact}
        title={stateText(t, moduleId, 'error', 'title') ?? t('states.error.title')}
        description={stateText(t, moduleId, 'error', 'desc')}
        action={retry}
      />
    </Card>
  );
}
