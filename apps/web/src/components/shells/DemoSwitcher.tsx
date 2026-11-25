'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Popover } from '@opendispatch/ui';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DemoBadge } from '@/components/opendispatch/DemoBadge';
import { DemoControls, type DemoOptionsView, type DemoSelection } from './DemoControls';
import styles from './DemoSwitcher.module.css';

/**
 * The demo switcher: a Demo pill in the top bar that opens the design system's Popover with
 * the demo controls. It is a demo control, not a product feature: oidc mode removes it together with the demo session
 *. Hooks for the specs: the pill is `[data-demo-switcher="trigger"]`, the panel's form is
 * `[data-demo-switcher="panel"]` (the pop-over is drawn in a portal, so the panel is not inside the pill).
 */
export function DemoSwitcher({ options, current }: { options: DemoOptionsView; current: DemoSelection }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const role = t(`roles.${current.role}`);

  return (
    <Popover
      align="end"
      width={360}
      className={styles.panel}
      label={t('demo.controls')}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={styles.pill} data-demo-switcher="trigger" aria-label={`${t('demo.controls')}: ${role}`}>
          <DemoBadge />
          <span className={styles.role}>{role}</span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </button>
      }
    >
      <DemoControls variant="panel" options={options} initial={current} submitLabel={t('demo.apply')} showSignOut onDone={() => setOpen(false)} />
    </Popover>
  );
}
