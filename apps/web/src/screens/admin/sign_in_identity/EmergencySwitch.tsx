'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { useAdminAction } from '@/components/opendispatch/patterns/useAdminAction';
import { ReasonSwitch } from '@/components/opendispatch/ReasonSwitch';
import { setEmergencySignIn } from './actions';

// "Emergency sign-in enabled": saves as soon as it is switched (the rest of the sign-in policy is read and written back as it is,
// actions.ts). Turning it off warns that only SSO can sign in now, as the mockup does. A view-only Administrator sees it disabled
// with "Managed by our staff in the shared tier".

export function EmergencySwitch({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const m = useTranslations('admin.sign_in_identity');
  const toast = useToast();
  const change = useAdminAction(setEmergencySignIn, {
    quiet: true,
    onSuccess: (saved) => {
      if (saved.enabled) toast({ title: m('toast.emergencyOn'), tone: 'success' });
      else toast({ title: m('em.off.title'), description: m('em.off.desc'), tone: 'warning' });
    },
  });
  return (
    <>
      <ReasonSwitch
        reason={canEdit ? null : m('ro.reason')}
        checked={enabled}
        label={m('em.enabled')}
        onCheckedChange={(next) => {
          if (canEdit) change.run({ enabled: next });
        }}
      />
      <ActionError error={change.error} onDismiss={change.reset} />
    </>
  );
}
