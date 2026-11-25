'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Badge, Button, Card, DescriptionList, StatusPill, Switch, Tag } from '@opendispatch/ui';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { AdminTable, type AdminTableColumn, type AdminTableRow } from '@/components/opendispatch/patterns/AdminTable';
import { ListToolbar } from '@/components/opendispatch/patterns/ListToolbar';
import { StubTag } from '@/components/opendispatch/patterns/StubTag';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { useUrlState } from '@/components/opendispatch/patterns/useUrlState';
import { ReasonHint, useGate } from '@/components/opendispatch/ReasonHint';
import { toggleRule } from './actions';
import { CHANNELS, SEVERITIES, SEVERITY_TONE, type QuietView, type RuleRow } from './types';
import styles from './Notifications.module.css';

// The Rules tab: the rule table with its search and two
// filters (severity, channel), and a switch per rule; the quiet-hours card sits beside it. A row opens the rule in a drawer
// (`?rule=`; the mockup's pencil is not built: every list in this app opens its record by the row). The switch writes at once and shows the saved state; a refusal is a toast. Only in-app
// notifications exist: an e-mail channel is stored on the rule and nothing is sent.

function RuleSwitch({ rule, name, canEdit }: { rule: RuleRow; name: string; canEdit: boolean }) {
  const m = useTranslations('admin.notifications_alerts');
  const gate = useGate(canEdit ? 'edit' : 'view');
  const [asked, setAsked] = useState<boolean>(rule.enabled);
  const toggle = useAdminAction(toggleRule, { quiet: true, failureToast: true });
  // While the write runs the switch shows the state asked for; afterwards it shows what the server saved.
  const shown = toggle.pending ? asked : rule.enabled;
  return (
    <Switch
      aria-label={`${m('aria.on')}: ${name}`}
      checked={shown}
      disabled={!canEdit || toggle.pending}
      onCheckedChange={(next) => {
        if (!gate.edit.allowed) return;
        setAsked(next);
        toggle.run({ ruleId: rule.id, enabled: next });
      }}
    />
  );
}

export interface RulesTableProps {
  readonly rules: readonly RuleRow[];
  readonly canEdit: boolean;
  readonly page: number | undefined;
  readonly emptyState: ReactNode;
}

export function RulesTable({ rules, canEdit, page, emptyState }: RulesTableProps) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();

  const columns: AdminTableColumn[] = [
    { key: 'event', header: m('col.event') },
    { key: 'channels', header: m('col.channels') },
    { key: 'recipients', header: m('col.recipients'), hideBelow: 'md' },
    { key: 'severity', header: m('col.severity') },
    { key: 'on', header: m('col.on'), align: 'center' },
  ];
  const rows: AdminTableRow[] = rules.map((rule) => {
    const name = m(`ev.${rule.event}`);
    return {
      id: rule.id,
      label: name,
      cells: {
        event: (
          <span className={styles.cell}>
            <span className={styles.strong}>{name}</span>
            <span className={styles.meta}>{m(`cat.${rule.category}`)}</span>
          </span>
        ),
        channels: (
          <span className={styles.tags}>
            {rule.channels.map((channel) => (
              <span key={channel} className={styles.inline}>
                <Badge tone="neutral" size="sm">
                  {m(`ch.${channel}`)}
                </Badge>
                {channel === 'email' ? <StubTag kind="notApplied" /> : null}
              </span>
            ))}
          </span>
        ),
        recipients: (
          <span className={styles.tags}>
            {rule.roles.map((role) => (
              <Tag key={role}>{t(`roles.${role}`)}</Tag>
            ))}
          </span>
        ),
        severity: <StatusPill status={m(`sev.${rule.severity}`)} tone={SEVERITY_TONE[rule.severity]} size="sm" />,
        on: <RuleSwitch rule={rule} name={name} canEdit={canEdit} />,
      },
    };
  });

  return (
    <Card padding="none">
      <ListToolbar
        searchLabel={m('rules.search')}
        filters={[
          { key: 'severity', label: m('f.severity'), options: SEVERITIES.map((value) => ({ value, label: m(`sev.${value}`) })) },
          { key: 'channel', label: m('col.channels'), options: CHANNELS.map((value) => ({ value, label: m(`ch.${value}`) })) },
        ]}
      />
      <AdminTable caption={m('rules.title')} columns={columns} rows={rows} rowParam="rule" page={page} pageSize={0} emptyState={emptyState} />
    </Card>
  );
}

/**
 * The quiet-hours card: the window, what it applies to, and that critical alerts always go. STORED, NOT APPLIED: nothing in this
 * phase holds an alert back, and the card says so with the "Not applied" tag.
 */
export function QuietCard({ quiet, canEdit }: { quiet: QuietView; canEdit: boolean }) {
  const m = useTranslations('admin.notifications_alerts');
  const t = useTranslations();
  const url = useUrlState();
  const gate = useGate(canEdit ? 'edit' : 'view');
  return (
    <Card padding="lg">
      <div className={styles.cardInner}>
        <div className={styles.head}>
          <span className={styles.headTitle}>
            <h2 className={styles.cardTitle}>{m('qh.title')}</h2>
            <StubTag kind="notApplied" />
          </span>
          <StatusPill status={quiet.enabled ? t('common.on') : t('common.off')} tone={quiet.enabled ? 'success' : 'neutral'} size="sm" />
        </div>
        <DescriptionList
          dense
          columns={1}
          items={[
            {
              label: m('qh.window'),
              value: (
                <span className={styles.inline}>
                  <bdi translate="no">{m('range', { from: quiet.start, to: quiet.end })}</bdi>
                  <Tag>
                    <span translate="no">Asia/Riyadh</span>
                  </Tag>
                </span>
              ),
            },
            { label: m('qh.applies'), value: quiet.appliesTo === 'email' ? m('qd.emailOnly') : m('qd.both') },
            { label: m('stat.critical'), value: m('qh.always') },
          ]}
        />
        <div className={styles.inline}>
          <ReasonHint reason={gate.edit.reason} visible={false}>
            <Button variant="secondary" size="sm" startIcon={<Pencil />} onClick={() => gate.edit.allowed && url.update({ quiet: '1' }, { history: 'push' })}>
              {m('qh.edit')}
            </Button>
          </ReasonHint>
        </div>
      </div>
    </Card>
  );
}
