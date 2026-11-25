// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Stack, Tag } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { getModule, type ApprovalKind, type ModuleId } from '@/lib/access';
import styles from './UsersRoles.module.css';
import type { AccessSummary } from './types';

// "Effective access" as the mockup draws it: what a role can edit, approve and view, each as a labelled group of chips
// (Ops modules geekblue, Admin modules red: category, never status), and how many modules the role does not see. Plain data
// in; server or client. The module names come from the core `nav.*.menu` messages, the approval kinds from the module's own.

function ModuleChip({ id }: { id: ModuleId }) {
  const t = useTranslations();
  const def = getModule(id);
  return <Tag color={def.console === 'ops' ? 'geekblue' : 'red'}>{t(def.menuKey)}</Tag>;
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <Stack gap={4} data-access-group="">
      <span className={styles.groupLabel}>
        {label} <bdi translate="no">({count})</bdi>
      </span>
      <div className={styles.chips}>{children}</div>
    </Stack>
  );
}

export function AccessGroups({ summary }: { summary: AccessSummary }) {
  const m = useTranslations('admin.users_roles');
  return (
    <Stack gap={12}>
      <Group label={m('acc.edit')} count={summary.edit.length}>
        {summary.edit.map((id) => (
          <ModuleChip key={id} id={id} />
        ))}
      </Group>
      <Group label={m('acc.approve')} count={summary.approve.length}>
        {summary.approve.map((kind: ApprovalKind) => (
          <Badge key={kind} tone="success" size="sm">
            {m(`kind.${kind}`)}
          </Badge>
        ))}
      </Group>
      <Group label={m('acc.view')} count={summary.view.length}>
        {summary.view.map((id) => (
          <ModuleChip key={id} id={id} />
        ))}
      </Group>
      {summary.hidden > 0 ? <span className={styles.meta}>{m('acc.hidden', { n: summary.hidden })}</span> : null}
    </Stack>
  );
}
