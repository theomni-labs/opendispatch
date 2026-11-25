// SPDX-License-Identifier: AGPL-3.0-only
import { int } from '@opendispatch/ui/format';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cx } from './cx';
import styles from './FallbackBanner.module.css';

export interface FallbackBannerProps {
  /** False: fallback armed (The customer dispatch takes over if OpenDispatch does not answer). True: it is assigning now. */
  active: boolean;
  /** "Fallback armed" or "Fallback active", already in the reader's language. */
  title: string;
  /** One short line: "The customer dispatch takes over after 5 s", "Case feed down since 10:43". */
  meta?: string | undefined;
  /** How many cases the customer's dispatch took. Omit to hide the figure. */
  count?: number | undefined;
}

// the project rules: OpenDispatch is never the only way a case gets assigned. The banner is a status region, so a change
// from armed to active is announced without moving focus.
export function FallbackBanner({ active, title, meta, count }: FallbackBannerProps) {
  const t = useTranslations('opendispatch.fallback');
  const locale = useLocale();
  const Icon = active ? TriangleAlert : ShieldCheck;
  return (
    <section className={cx(styles.banner, active && styles.active)} role="status" aria-live="polite" data-active={String(active)}>
      <span className={styles.icon}>
        <Icon aria-hidden="true" />
      </span>
      <div className={styles.text}>
        <span className={styles.title}>{title}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      {count === undefined ? null : (
        <span className={styles.count}>
          <b className={styles.number} dir="ltr">
            {int(count, locale)}
          </b>
          <span>{t('cases')}</span>
        </span>
      )}
    </section>
  );
}
