'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Card, Tile } from '@opendispatch/ui';
import { Headset, Moon, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MouseEvent, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import styles from './ScenarioLab.module.css';
import { TEMPLATE_KEYS, type TemplateKey } from './types';

// Start from (#sc2): three template cards

const TILE: Readonly<Record<TemplateKey, { readonly color: 'geekblue' | 'magenta' | 'green'; readonly icon: ReactNode }>> = {
  people: { color: 'geekblue', icon: <Users /> },
  ramadan: { color: 'magenta', icon: <Moon /> },
  remote: { color: 'green', icon: <Headset /> },
};

export interface TemplateCardsProps {
  readonly canEdit: boolean;
}

export function TemplateCards({ canEdit }: TemplateCardsProps) {
  const m = useTranslations('ops.scenario_lab');
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');

  return (
    <div className={styles.templateGrid}>
      {TEMPLATE_KEYS.map((key) => {
        const tile = TILE[key];
        const href = url.hrefFor({ scenario: 'new', tpl: key });
        return (
          <ReasonHint key={key} reason={gate.edit.reason} visible={false}>
            <Card
              as={Link}
              href={href}
              padding="md"
              interactive
              className={styles.templateCard}
              onClick={(event: MouseEvent) => {
                if (!gate.edit.allowed) event.preventDefault();
              }}
            >
              <Tile icon={tile.icon} color={tile.color} />
              <span className={styles.templateText}>
                <span className={styles.templateTitle}>{m(`tpl.${key}.name`)}</span>
                <span className={styles.templateMeta}>{m(`tpl.${key}.meta`)}</span>
              </span>
            </Card>
          </ReasonHint>
        );
      })}
    </div>
  );
}
