'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Timeline, useFormat, type TimelineItem, type Tone } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { shownActorType } from './system-actor';

// Audit events as a Timeline: Forecast and Model "Recent changes", the emergency administrator's recent use.
// Plain data in: the events as the data layer returns them and the actor names from `actorNames(ctx, events)` (audit-actors.ts,
// server), so a reader without access to the user list still sees who did it. The summary is the data layer's English
// text, marked lang="en"; the action code and the actor's name are data (translate="no"), on one meta line under it (the
// Timeline's own `actor` slot cannot be marked translate="no", so an English name would read as untranslated Arabic
// text). A `denied` event is danger.

export interface AuditTimelineEvent {
  readonly id: string;
  readonly action: string;
  readonly summary_en: string;
  /** ISO 8601 with offset. */
  readonly occurred_at: string;
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly actor_type: 'user' | 'system' | 'emergency_admin' | 'demo';
  readonly actor_user_id?: string | null | undefined;
  /** The summary in the reader's language; absent: the English text. */
  readonly title?: ReactNode | undefined;
}

export interface AuditTimelineProps {
  readonly events: readonly AuditTimelineEvent[];
  /** Display names by user id (`actorNames`). */
  readonly names: Readonly<Record<string, string>>;
  readonly dense?: boolean | undefined;
}

const TONES: Readonly<Record<AuditTimelineEvent['outcome'], Tone>> = { success: 'neutral', failure: 'warning', denied: 'danger' };

export function AuditTimeline({ events, names, dense = true }: AuditTimelineProps) {
  const t = useTranslations('patterns.audit');
  const format = useFormat();
  if (events.length === 0) return <p className="t-caption text-muted">{t('empty')}</p>;

  const items: TimelineItem[] = events.map((event) => {
    const actor =
      event.actor_user_id !== null && event.actor_user_id !== undefined && names[event.actor_user_id] !== undefined
        ? (names[event.actor_user_id] as string)
        : shownActorType(event) === 'system'
          ? t('system')
          : t('unknownActor');
    return {
      id: event.id,
      title:
        event.title ?? (
          <span lang="en" dir="ltr" translate="no">
            {event.summary_en}
          </span>
        ),
      time: `${format.date(event.occurred_at)} ${format.time(event.occurred_at)}`,
      description: (
        <>
          <bdi translate="no">{actor}</bdi>
          {' · '}
          <bdi dir="ltr" translate="no">
            {event.action}
          </bdi>
          {' · '}
          {t(`outcome.${event.outcome}`)}
        </>
      ),
      tone: TONES[event.outcome],
    };
  });
  return <Timeline items={items} dense={dense} />;
}
