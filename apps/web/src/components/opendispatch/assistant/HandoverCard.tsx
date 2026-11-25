'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Button, Card, Drawer, EmptyState, SegmentedControl, SkeletonText, StatusPill, Tabs, Tag, useToast, type Tone } from '@opendispatch/ui';
import { time } from '@opendispatch/ui/format';
import { Bell, ClipboardList, Copy, Lock, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AlertsDigestView, HandoverView } from './types';
import { ActionError } from '../patterns/ActionError';
import { useAdminAction } from '../patterns/useAdminAction';
import { Reason } from '../ReasonHint';
import type { ActionResult } from '@/lib/actions/types';
import { AnswerMeta } from './AnswerMeta';
import { AnswerText } from './AnswerText';
import styles from './Assistant.module.css';

// Shift handover and Alerts digest

const WINDOWS = ['4', '8', '12'] as const;
type Tab = 'handover' | 'alerts';

const SEVERITY_TONE: Record<string, Tone> = { critical: 'danger', warning: 'warning', info: 'info' };

export interface HandoverCardProps {
  readonly handoverAction: (input: { window_hours: number; locale: string }) => Promise<ActionResult<HandoverView>>;
  readonly alertsAction: (input: { locale: string }) => Promise<ActionResult<AlertsDigestView>>;
  /** False: the assistant is off; the button says why. */
  readonly configured: boolean;
  /** The Alerts tab: any signed-in role. */
  readonly alertsDigest: boolean;
  /** The bell's count, for the Alerts tab. */
  readonly unread: number;
}

export function HandoverCard(props: HandoverCardProps) {
  const t = useTranslations('opendispatch.assistant');
  const [open, setOpen] = useState(false);
  return (
    <Card padding="md" className={styles.card} data-assistant="handover">
      <div className={styles.head}>
        <Sparkles className={styles.icon} aria-hidden="true" />
        <h2 className={styles.title}>{t('handoverTitle')}</h2>
        <Button variant="secondary" size="sm" startIcon={<ClipboardList />} onClick={() => setOpen(true)}>
          {t('handoverOpen')}
        </Button>
      </div>
      <HandoverDrawer {...props} open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

export interface HandoverDrawerProps extends HandoverCardProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** The drawer alone, for a screen that opens it from a menu. */
export function HandoverDrawer({ handoverAction, alertsAction, configured, alertsDigest, unread, open, onClose }: HandoverDrawerProps) {
  const t = useTranslations('opendispatch.assistant');
  const locale = useLocale();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('handover');
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>('8');
  const [handover, setHandover] = useState<HandoverView | null>(null);
  const [digest, setDigest] = useState<AlertsDigestView | null>(null);
  const runHandover = useAdminAction(handoverAction, { quiet: true, onSuccess: setHandover });
  const runDigest = useAdminAction(alertsAction, { quiet: true, onSuccess: setDigest });
  const active = tab === 'handover' ? runHandover : runDigest;
  const text = tab === 'handover' ? (handover?.text ?? '') : (digest?.text ?? '');

  const summarise = () => {
    if (!configured) return;
    if (tab === 'handover') {
      setHandover(null);
      runHandover.run({ window_hours: Number(hours), locale });
    } else {
      setDigest(null);
      runDigest.run({ locale });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t('copied'), tone: 'success' });
    } catch {
      toast({ title: t('copyFailed'), tone: 'danger' });
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('handoverTitle')}
      subtitle={t('handoverScope')}
      footer={
        <div className={styles.footerSplit}>
          <Button variant="ghost" startIcon={<Copy />} aria-disabled={text === '' ? true : undefined} onClick={() => text !== '' && void copy()}>
            {t('copy')}
          </Button>
          <span className={styles.push} />
          {configured ? null : <Reason icon={<Lock />}>{t('off')}</Reason>}
          <Button variant="primary" startIcon={<Sparkles />} loading={active.pending} aria-disabled={configured ? undefined : true} onClick={summarise}>
            {t('summarise')}
          </Button>
        </div>
      }
    >
      <div className={styles.drawerBody}>
        {alertsDigest ? (
          <Tabs
            ariaLabel={t('handoverTitle')}
            value={tab}
            onChange={(v) => setTab(v === 'alerts' ? 'alerts' : 'handover')}
            items={[
              { value: 'handover', label: t('handoverTab') },
              { value: 'alerts', label: t('alertsTab'), count: unread },
            ]}
          />
        ) : null}
        {tab === 'handover' ? (
          <div className={styles.drawerBody} data-assistant="handover-panel">
            <div className={styles.calls}>
              <span className={styles.label} id="ho-window">
                {t('window')}
              </span>
              <SegmentedControl
                aria-labelledby="ho-window"
                value={hours}
                onChange={(v) => setHours(WINDOWS.find((w) => w === v) ?? '8')}
                options={WINDOWS.map((w) => ({ value: w, label: t(`window${w}`) }))}
              />
              {handover === null ? null : (
                <span className={styles.metaText} translate="no">
                  {t('windowRange', { from: time(handover.window_from), to: time(handover.window_to) })}
                </span>
              )}
            </div>
            {runHandover.pending ? <SkeletonText lines={5} announce /> : null}
            <ActionError error={runHandover.error} onDismiss={runHandover.reset} />
            {handover === null ? null : (
              <Card padding="md" className={styles.card}>
                {handover.answer_path === 'fallback_summary' ? <Alert tone="info">{t('figuresOnly')}</Alert> : null}
                <div aria-live="polite">
                  <AnswerText text={handover.text} />
                </div>
                <AnswerMeta provider={handover.provider} model={handover.model} durationMs={handover.duration_ms} />
                <details className={styles.sent}>
                  <summary>{t('sent')}</summary>
                  <code className={styles.code} dir="ltr" translate="no">
                    {handover.sent}
                  </code>
                </details>
              </Card>
            )}
          </div>
        ) : (
          <div className={styles.drawerBody} data-assistant="alerts-panel">
            {runDigest.pending ? <SkeletonText lines={3} announce /> : null}
            <ActionError error={runDigest.error} onDismiss={runDigest.reset} />
            {digest !== null && digest.unread === 0 ? <EmptyState compact icon={<Bell />} title={t('noAlerts')} /> : null}
            {digest === null || digest.unread === 0 ? null : (
              <>
                <ul className={styles.groupList}>
                  {digest.groups.map((g) => (
                    <li key={`${g.category}-${g.severity}`} className={styles.group}>
                      <Tag color="gray">{t(`category.${g.category}`)}</Tag>
                      <StatusPill size="sm" tone={SEVERITY_TONE[g.severity] ?? 'neutral'} status={t(`severity.${g.severity}`)} />
                      <span className={styles.push} />
                      <span className={styles.count}>{g.count}</span>
                    </li>
                  ))}
                </ul>
                <Card padding="md" className={styles.card}>
                  {digest.answer_path === 'fallback_summary' ? <Alert tone="info">{t('figuresOnly')}</Alert> : null}
                  <div aria-live="polite">
                    <AnswerText text={digest.text} />
                  </div>
                  <AnswerMeta provider={digest.provider} model={digest.model} durationMs={digest.duration_ms} illustrative={false} />
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
