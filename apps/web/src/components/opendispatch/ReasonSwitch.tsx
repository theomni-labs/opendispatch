'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Switch, Tooltip, type SwitchProps } from '@opendispatch/ui';
import styles from './ReasonSwitch.module.css';

// A Switch that says why it cannot be used. The design system's Switch has no aria-disabled (only
// the native `disabled`, which cannot take focus, so it shows no tooltip): with a `reason` the Switch is disabled and sits in a
// focusable wrapper that carries the design system tooltip on hover and on keyboard focus, and names the reason for a screen
// reader. Without a reason it is the plain Switch. The reason is one short line in the reader's language, from the caller.
// Used by the Sign-in and Identity, API and Webhooks, Security and Compliance and Localization screens.

export interface ReasonSwitchProps extends SwitchProps {
  /** Why the switch is unavailable, or null/undefined when it is available. */
  readonly reason?: string | null | undefined;
}

export function ReasonSwitch({ reason, disabled = false, ...switchProps }: ReasonSwitchProps) {
  if (reason === null || reason === undefined || reason === '') return <Switch {...switchProps} disabled={disabled} />;
  // The wrapper, not the switch, is what takes focus (a native `disabled` control cannot): it needs its own role and
  // name, not just the tooltip's aria-describedby, which a screen reader only has while the tooltip is open.
  const name = typeof switchProps.label === 'string' ? switchProps.label : switchProps['aria-label'];
  return (
    <Tooltip content={reason}>
      <span className={styles.wrap} role="button" aria-disabled="true" aria-label={name} tabIndex={0} data-gated="">
        <Switch {...switchProps} disabled />
      </span>
    </Tooltip>
  );
}
