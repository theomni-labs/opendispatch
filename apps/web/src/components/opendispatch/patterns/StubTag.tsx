// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Tooltip } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';

// Labels a stub. Two tags, and only these:
//   "Demo"        scripted behaviour: the identity provider test, an integration or webhook test, import validation, the
//                 update agent, the diagnostics file, Retrain now, the evidence file, "Switch to this user".
//   "Not applied" a setting that is stored and audited but has no effect yet: digit system, calendars, quiet hours, rate
//                 limits, the Ramadan switch, the automatic stage's guardrail.
// A tag sits in the header's `meta` slot when it covers the whole screen, and next to the control when it covers one
// setting. It is a small muted tag, not a paragraph (minimal.md); the tooltip says what it means, on hover and on keyboard
// focus (the tag takes a tab stop for that, so the hint is not for the mouse alone). A stub is reported as a
// stub in docs/, never as working. Server or client component.

export type StubKind = 'demo' | 'notApplied';

export interface StubTagProps {
  readonly kind: StubKind;
}

export function StubTag({ kind }: StubTagProps) {
  const t = useTranslations('patterns.stub');
  return (
    <Tooltip content={t(kind === 'demo' ? 'demoHint' : 'notAppliedHint')}>
      <span data-stub={kind} tabIndex={0}>
        <Badge size="sm" tone="neutral" variant="outline">
          {t(kind)}
        </Badge>
      </span>
    </Tooltip>
  );
}
