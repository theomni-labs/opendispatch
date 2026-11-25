// SPDX-License-Identifier: AGPL-3.0-only
import { NotFoundPanel } from '@/components/opendispatch/ModuleStates';
import styles from './page.module.css';

// 404 outside the consoles: no shell, so a small centred page. "Go home" leads to the demo start page, which sends a
// signed-in person on to their landing module.
export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.narrow}>
        <NotFoundPanel homeHref="/" />
      </div>
    </main>
  );
}
