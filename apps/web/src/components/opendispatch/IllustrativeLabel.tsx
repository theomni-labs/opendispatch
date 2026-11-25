// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslations } from 'next-intl';
import styles from './IllustrativeLabel.module.css';

// the project rules: a placeholder number carries this label next to it, so nobody reads it as a
// measured figure. Put it right after the number (or once at the head of a group of them).
export function IllustrativeLabel() {
  const t = useTranslations('common');
  return <span className={styles.label}>{t('illustrative')}</span>;
}
