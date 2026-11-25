// SPDX-License-Identifier: AGPL-3.0-only
import { Badge } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';

/** Marks a control as a demo control (the warning tone, as the mockup's Demo tag). */
export function DemoBadge() {
  const t = useTranslations('demo');
  return (
    <Badge tone="warning" size="sm">
      {t('badge')}
    </Badge>
  );
}
