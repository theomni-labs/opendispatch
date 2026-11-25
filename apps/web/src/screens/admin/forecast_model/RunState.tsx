'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { createContext, useContext, type ReactNode } from 'react';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { runForecast } from './actions';
import styles from './ForecastModel.module.css';

// One run at a time: both buttons and the card share it

interface RunApi {
  readonly pending: boolean;
  readonly start: () => void;
}

const Context = createContext<RunApi>({ pending: false, start: () => undefined });

export function RunProvider({ children }: { children: ReactNode }) {
  const m = useTranslations('admin.forecast_model');
  const toast = useToast();
  const run = useAdminAction(runForecast, {
    quiet: true,
    onSuccess: () => toast({ title: m('toast.run.title'), description: m('toast.run.desc'), tone: 'success' }),
    failureToast: true,
  });
  return (
    <Context.Provider value={{ pending: run.pending, start: () => run.run() }}>
      {children}
      <span className={styles.srOnly} role="status" aria-live="polite">
        {run.pending ? m('r.running') : ''}
      </span>
    </Context.Provider>
  );
}

export const useRun = (): RunApi => useContext(Context);
