// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, DescriptionList, StatusPill, TaskList } from '@opendispatch/ui';
import { date, time } from '@opendispatch/ui/format';
import { BellRing, ExternalLink, FingerprintPattern, ScrollText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AuditTimeline } from '@/components/opendispatch/patterns/AuditTimeline';
import { EmergencySwitch } from './EmergencySwitch';
import styles from './SignIn.module.css';
import type { EmergencyView, PolicyView } from './types';

// The Emergency admin tab: the local account that works when SSO is down, what every use of it does,
// the switch, and its recent use from the Audit Log. Server or client: plain data in.

export interface EmergencyTabProps {
  readonly emergency: EmergencyView;
  readonly policy: PolicyView;
  readonly canEdit: boolean;
  readonly locale: 'en' | 'ar';
}

export function EmergencyTab({ emergency, policy, canEdit, locale }: EmergencyTabProps) {
  const m = useTranslations('admin.sign_in_identity');
  const last =
    emergency.lastSignIn === null ? (
      m('em.never')
    ) : (
      <span translate="no">
        {date(emergency.lastSignIn, { locale })} <bdi dir="ltr">{time(emergency.lastSignIn)}</bdi>
      </span>
    );
  return (
    <div className={styles.detailGrid}>
      <div className={styles.col}>
        <Card padding="lg">
          <div className={styles.stack}>
            <div className={styles.headRow}>
              <h2 className={styles.sectionTitle}>{m('em.title')}</h2>
              <StatusPill status={m(policy.emergencyEnabled ? 'em.active' : 'status.off')} tone={policy.emergencyEnabled ? 'success' : 'neutral'} size="sm" />
            </div>
            <DescriptionList
              columns={2}
              items={[
                { label: m('em.name'), value: emergency.name === null ? '-' : <span translate="no">{emergency.name}</span> },
                { label: m('em.email'), value: emergency.email === null ? '-' : <span translate="no">{emergency.email}</span> },
                { label: m('em.signin'), value: m('em.local') },
                { label: m('em.mfaLabel'), value: m('em.mfa') },
                { label: m('em.last'), value: last },
              ]}
            />
          </div>
        </Card>
        <Card padding="lg">
          <div className={styles.stack}>
            <h2 className={styles.sectionTitle}>{m('em.rules')}</h2>
            <TaskList
              items={[
                { id: 'mfa', title: m('em.r1'), icon: <FingerprintPattern />, color: 'green' },
                { id: 'alert', title: m('em.r2'), icon: <BellRing />, color: 'red' },
                { id: 'audit', title: m('em.r3'), icon: <ScrollText />, color: 'geekblue' },
              ]}
            />
            <div>
              <EmergencySwitch enabled={policy.emergencyEnabled} canEdit={canEdit} />
            </div>
          </div>
        </Card>
      </div>
      <aside className={styles.col}>
        <Card padding="lg">
          <div className={styles.stack}>
            <h2 className={styles.sectionTitle}>{m('em.recent')}</h2>
            <AuditTimeline events={emergency.events} names={emergency.names} />
            <div>
              <Button variant="secondary" size="sm" href="/admin/audit-log?q=auth.emergency" endIcon={<ExternalLink />}>
                {m('em.audit')}
              </Button>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}
