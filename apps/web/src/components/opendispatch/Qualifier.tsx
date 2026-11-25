// SPDX-License-Identifier: AGPL-3.0-only
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import styles from './Qualifier.module.css';

export interface QualifierProps {
  /** The note, already in the reader's language. Default: "inferred". */
  children?: ReactNode | undefined;
  /** Puts the info icon before the note. */
  icon?: boolean | undefined;
}

// the project rules: handling is `field` or `remote_inferred` until the customer supplies an explicit field, and the screen
// says "inferred" next to it. Any other note tied to a value ("from assignment", "estimated") goes in `children`.
export function Qualifier({ children, icon = false }: QualifierProps) {
  const t = useTranslations('opendispatch.qualifier');
  return (
    <span className={styles.qualifier}>
      {icon ? <Info className={styles.icon} aria-hidden="true" /> : null}
      <span>{children ?? t('inferred')}</span>
    </span>
  );
}
