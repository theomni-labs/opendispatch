'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Badge, Card, DescriptionList, SegmentedControl, Tag } from '@opendispatch/ui';
import { Siren, TriangleAlert, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { SEVERITY_TONE, type EventType, type QuietView, type RuleRow } from './types';
import styles from './Notifications.module.css';

// The alert preview: three example alerts (a model pause, a
// feed outage, an emergency sign-in), each with what its rule does today: who it is sent to, by which channels, and what happens
// at night. The recipients, channels and severity are read from the rule, so an edit shows here after saving. The example lines
// are examples, not events. What happens at night follows the quiet-hours window, which is STORED, NOT APPLIED (nothing holds an
// alert back yet): the row says so with the "Not applied" tag.

type ExampleKey = 'model' | 'feed' | 'emg';

interface Example {
  readonly key: ExampleKey;
  readonly event: EventType;
  readonly icon: ReactNode;
}

const EXAMPLES: readonly Example[] = [
  { key: 'model', event: 'model_paused', icon: <TriangleAlert /> },
  { key: 'feed', event: 'integration_down', icon: <WifiOff /> },
  { key: 'emg', event: 'emergency_admin_sign_in', icon: <Siren /> },
];

export interface AlertPreviewProps {
  readonly rules: readonly RuleRow[];
  readonly quiet: QuietView;
  /** The name of the person looking, for the model example ("Nadia paused the forecast"); the role's name when unknown. */
  readonly me: string | null;
}

export function AlertPreview({ rules, quiet, me }: AlertPreviewProps) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();
  const [key, setKey] = useState<ExampleKey>('model');
  const example = EXAMPLES.find((e) => e.key === key) ?? (EXAMPLES[0] as Example);
  const rule = rules.find((r) => r.event === example.event);

  // Critical alerts are never held; an alert with no e-mail channel has nothing to hold.
  const held = rule !== undefined && quiet.enabled && rule.channels.includes('email') && rule.severity !== 'critical';
  const body =
    example.key === 'model'
      ? m.rich('pv.model.b', { name: me ?? t('roles.administrator'), n: (chunks) => <bdi translate="no">{chunks}</bdi> })
      : m(`pv.${example.key}.b`);

  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <h2 className={styles.cardTitle}>{m('pv.title')}</h2>
          {rule !== undefined && !rule.enabled ? (
            <Badge tone="neutral" size="sm">
              {m('pv.off')}
            </Badge>
          ) : null}
        </div>
        <SegmentedControl
          size="sm"
          ariaLabel={m('pv.title')}
          value={key}
          onChange={(next) => setKey(EXAMPLES.find((e) => e.key === next)?.key ?? key)}
          options={EXAMPLES.map((e) => ({ value: e.key, label: m(`pv.${e.key}.label`) }))}
        />
        <div data-preview={example.key}>
          <Alert tone={SEVERITY_TONE[rule?.severity ?? 'info']} icon={example.icon} title={m(`pv.${example.key}.t`)}>
            {body}
          </Alert>
        </div>
        {rule === undefined ? null : (
          <DescriptionList
            dense
            columns={1}
            items={[
              {
                label: m('pv.sentTo'),
                value:
                  rule.roles.length === 0 ? (
                    '-'
                  ) : (
                    <span className={styles.tags}>
                      {rule.roles.map((role) => (
                        <Tag key={role}>{t(`roles.${role}`)}</Tag>
                      ))}
                    </span>
                  ),
              },
              { label: m('col.channels'), value: rule.channels.length === 0 ? '-' : rule.channels.map((c) => m(`ch.${c}`)).join(' · ') },
              {
                label: m('pv.night.label'),
                value: (
                  <span className={styles.inline}>
                    {held ? m('pv.night.held', { end: quiet.end }) : m('pv.night.now')}
                    <StubTag kind="notApplied" />
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
