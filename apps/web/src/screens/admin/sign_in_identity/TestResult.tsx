'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Stack, Timeline, type TimelineItem } from '@opendispatch/ui';
import { Check, CircleAlert, CircleCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { STEP_LABEL } from './presets';
import type { TestOutcome } from './types';

// The outcome of the connection test (Keycloak's own checks, or a LABELLED STUB when Keycloak is not connected): an alert
// that says whether it passed, the
// reference code to quote when it did not, and one line per check. The steps are translated from the data layer's `code`
// (DG14); a failed step's own message is the data layer's English text, marked lang="en", except the one the mockup words in
// Arabic ("The provider address did not answer.").

const REACH_MESSAGE = 'The provider address did not answer.';

export function TestResult({ result }: { result: TestOutcome }) {
  const m = useTranslations('admin.sign_in_identity');
  const items: TimelineItem[] = result.steps.map((step, index) => {
    const labelKey = step.code === null ? undefined : STEP_LABEL[step.code];
    const known = step.code === 'reach' && step.message === REACH_MESSAGE;
    return {
      id: `${step.code ?? 'step'}-${index}`,
      title: labelKey === undefined ? <span lang="en" dir="ltr" translate="no">{step.name}</span> : m(labelKey),
      tone: step.ok ? 'success' : 'danger',
      icon: step.ok ? <Check /> : <X />,
      description: step.ok || step.message === null ? undefined : known ? m('fail.reach') : <span lang="en" dir="ltr" translate="no">{step.message}</span>,
    };
  });
  return (
    <Stack gap={12} data-test-result={result.ok ? 'passed' : 'failed'}>
      <Alert tone={result.ok ? 'success' : 'danger'} icon={result.ok ? <CircleCheck /> : <CircleAlert />} title={result.ok ? m('ok.title') : m('fail.title')}>
        {result.ok || result.referenceCode === null ? null : <span translate="no">{m('ref', { code: result.referenceCode })}</span>}
      </Alert>
      <Timeline dense items={items} />
    </Stack>
  );
}
