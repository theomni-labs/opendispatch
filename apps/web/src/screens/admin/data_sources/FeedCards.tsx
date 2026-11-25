'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, DescriptionList, StatusPill, Switch, Tile, useFormat, useToast, type Tone, type TileColor } from '@opendispatch/ui';
import { LocateFixed, RadioTower, Route, Send, Sun, TriangleAlert, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { Reason, ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { switchFeed, testFeed } from './actions';
import type { FallbackStateName, FeedHealth, FeedKind, FeedView } from './types';
import styles from './DataSources.module.css';
import { useDateTime } from '@/components/opendispatch/useDateTime';

// The feed cards: one card per feed with its health, the last event,
// the latency and, for the assignment channel, its timeout; a Test button and an on/off switch. THE INTEGRATION TEST IS A
// SCRIPTED STUB (the data layer answers from the stored health and sends nothing), so the latency shown is only what a test on
// this screen returned; a feed nobody has tested here shows "-". Latency figures are Illustrative (the section says so).

const ICON: Readonly<Record<FeedKind, ReactNode>> = {
  case_feed: <RadioTower />,
  agent_feed: <LocateFixed />,
  assignment_channel: <Send />,
  weather_feed: <Sun />,
  routing_feed: <Route />,
  other: <Zap />,
};
const TILE: Readonly<Record<FeedKind, TileColor>> = { case_feed: 'geekblue', agent_feed: 'magenta', assignment_channel: 'green', weather_feed: 'gold', routing_feed: 'red', other: 'geekblue' };
const HEALTH_TONE: Readonly<Record<FeedHealth, Tone>> = { healthy: 'success', degraded: 'warning', down: 'danger', disabled: 'neutral', unknown: 'neutral' };
/** An answer this slow or slower is called slow. */
const SLOW_MS = 1000;

export interface FeedCardsProps {
  readonly feeds: readonly FeedView[];
  readonly fallbackState: FallbackStateName;
  /** The fallback timeout of the install, shown for the assignment channel when the feed has none of its own. */
  readonly timeoutSeconds: number;
  readonly canEdit: boolean;
}

export function FeedCards({ feeds, fallbackState, timeoutSeconds, canEdit }: FeedCardsProps) {
  const gate = useGate(canEdit ? 'edit' : 'view');
  return (
    <div className={styles.stack}>
      {gate.edit.reason === null ? null : <Reason>{gate.edit.reason}</Reason>}
      <div className={styles.feeds}>
        {feeds.map((feed) => (
          <FeedCard key={feed.id} feed={feed} busy={feed.kind === 'case_feed' && fallbackState === 'maintenance'} timeoutSeconds={timeoutSeconds} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}

function FeedCard({ feed, busy, timeoutSeconds, canEdit }: { feed: FeedView; busy: boolean; timeoutSeconds: number; canEdit: boolean }) {
  const m = useTranslations('admin.data_sources');
  const t = useTranslations();
  const format = useFormat();
  const dateTime = useDateTime();
  const toast = useToast();
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [latency, setLatency] = useState<number | null>(null);
  const name = feed.kind === 'other' ? feed.name : m(`feed.${feed.kind}`);

  const test = useAdminAction(testFeed, {
    quiet: true,
    onSuccess: (result) => {
      setLatency(result.latencyMs);
      if (!feed.enabled) toast({ title: m('toast.off', { feed: name }), tone: 'info' });
      else if (!result.ok) toast({ title: m('toast.down', { feed: name }), tone: 'danger' });
      else if ((result.latencyMs ?? 0) >= SLOW_MS) toast({ title: m('toast.slow', { feed: name }), tone: 'warning' });
      else toast({ title: m('toast.ok', { feed: name, ms: result.latencyMs ?? 0 }), tone: 'success' });
    },
  });
  const toggle = useAdminAction(switchFeed, {
    quiet: true,
    onSuccess: (result) => toast({ title: result.enabled ? m('toast.on', { feed: name }) : m('toast.offNow', { feed: name }), tone: result.enabled ? 'success' : 'info' }),
  });

  const lastEvent = feed.lastSuccessAt === null ? '-' : dateTime(feed.lastSuccessAt);
  const latencyText = latency === null ? '-' : latency >= 1000 ? `${format.num(latency / 1000, 1)} ${m('uom.s')}` : `${format.int(latency)} ${m('uom.ms')}`;
  const items = [
    { label: m('last'), value: <bdi dir="ltr" translate="no">{lastEvent}</bdi> },
    { label: m('latency.label'), value: <bdi dir="ltr" translate="no">{latencyText}</bdi> },
    ...(feed.kind === 'assignment_channel' ? [{ label: m('fb.timeout'), value: <bdi dir="ltr" translate="no">{`${format.int(feed.timeoutSeconds ?? timeoutSeconds)} ${m('uom.s')}`}</bdi> }] : []),
  ];

  return (
    <Card padding="lg" data-feed={feed.kind}>
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <div className={styles.headTitle}>
            <Tile icon={ICON[feed.kind]} color={TILE[feed.kind]} shape="square" size="md" />
            <div className={styles.stackTight}>
              <h3 className={styles.cardTitle}>{name}</h3>
              <span className={styles.meta}>
                {m(`dir.${feed.direction}`)}
                {feed.simulated ? ` · ${m('simulated')}` : null}
              </span>
            </div>
          </div>
          <span className={styles.inline}>
            {busy ? (
              <Badge tone="warning" size="sm">
                {m('busy')}
              </Badge>
            ) : null}
            <StatusPill status={m(`health.${feed.health}`)} tone={HEALTH_TONE[feed.health]} size="sm" />
          </span>
        </div>
        <DescriptionList dense columns={2} items={items} />
        {feed.lastError === null || feed.health === 'healthy' || feed.health === 'disabled' ? null : (
          <Reason icon={<TriangleAlert />}>
            <span lang="en" dir="ltr" translate="no">
              {feed.lastError}
            </span>
          </Reason>
        )}
        <div className={styles.between}>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Zap />} loading={test.pending} onClick={() => gate.edit.allowed && test.run({ integrationId: feed.id })}>
              {m('test')}
            </Button>
          </ReasonHint>
          <Switch
            aria-label={name}
            label={feed.enabled ? t('common.on') : t('common.off')}
            checked={feed.enabled}
            disabled={!canEdit || toggle.pending}
            onCheckedChange={(next) => gate.edit.allowed && toggle.run({ integrationId: feed.id, enabled: next })}
          />
        </div>
        <ActionError error={test.error ?? toggle.error} onDismiss={() => (test.error === null ? toggle.reset() : test.reset())} />
      </div>
    </Card>
  );
}
