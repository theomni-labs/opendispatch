// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
} from '@ant-design/icons';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLabels } from '../provider';
import { cx, type Tone } from '../types';
import styles from './toast.module.css';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
  /** Milliseconds before it goes by itself. Default 4500; 0 or less keeps it until dismissed. */
  duration?: number;
}

/** `const toast = useToast(); toast({ title })`, or `const { toast, dismiss } = useToast()`. */
export interface ToastApi {
  (options: ToastOptions): string;
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface Shown extends ToastOptions {
  id: string;
}

const KEEP = 5;
const DURATION = 4500;

const ToastContext = createContext<ToastApi | null>(null);

const subscribeNothing = () => () => undefined;
const useMounted = () =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );


const outside: ToastApi = Object.assign(
  (options: ToastOptions) => {
    console.warn('useToast() outside <ToastProvider>; not shown:', options.title);
    return '';
  },
  { toast: () => '', dismiss: () => undefined },
);

export interface ToastProviderProps {
  children?: ReactNode;
}

/**
 * Short notices in the style of Ant Design's notification, in one labelled live region at the inline end of the
 * bottom edge. A notice has role status, or alert for the danger tone. At most five are kept.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const label = useLabels();
  const mounted = useMounted();
  const [shown, setShown] = useState<Shown[]>([]);

  const api = useMemo<ToastApi>(() => {
    const dismiss = (id: string) => setShown((list) => list.filter((item) => item.id !== id));
    const toast = (options: ToastOptions) => {
      const id = `toast-${crypto.randomUUID()}`;
      setShown((list) => [...list, { ...options, id }].slice(-KEEP));
      return id;
    };
    return Object.assign(toast, { toast, dismiss });
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted
        ? createPortal(
            <div className={styles.region} role="region" aria-live="polite" aria-relevant="additions" aria-label={label('toast.region')}>
              {shown.map((item) => (
                <Notice key={item.id} item={item} onDismiss={api.dismiss} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? outside;
}

const ICON: Record<Tone, ReactNode> = {
  neutral: <InfoCircleFilled aria-hidden="true" aria-label="" />,
  accent: <InfoCircleFilled aria-hidden="true" aria-label="" />,
  info: <InfoCircleFilled aria-hidden="true" aria-label="" />,
  success: <CheckCircleFilled aria-hidden="true" aria-label="" />,
  warning: <ExclamationCircleFilled aria-hidden="true" aria-label="" />,
  danger: <CloseCircleFilled aria-hidden="true" aria-label="" />,
};

function Notice({ item, onDismiss }: { item: Shown; onDismiss: (id: string) => void }) {
  const label = useLabels();
  const [paused, setPaused] = useState(false);
  const tone = item.tone ?? 'neutral';
  const wait = item.duration ?? DURATION;

  useEffect(() => {
    if (paused || wait <= 0) return;
    const timer = window.setTimeout(() => onDismiss(item.id), wait);
    return () => window.clearTimeout(timer);
  }, [paused, wait, onDismiss, item.id]);

  return (
    <div
      className={cx(styles.toast, styles[tone])}
      role={tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className={styles.icon} aria-hidden="true">
        {ICON[tone]}
      </span>
      <div className={styles.content}>
        <div className={styles.title}>{item.title}</div>
        {item.description ? <div className={styles.description}>{item.description}</div> : null}
        {item.action ? <div className={styles.action}>{item.action}</div> : null}
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(item.id)}
        aria-label={label('toast.dismiss')}
        title={label('toast.dismissTitle')}
      >
        <CloseOutlined aria-label="" aria-hidden="true" />
      </button>
    </div>
  );
}
