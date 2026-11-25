'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Tooltip } from '@opendispatch/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cloneElement, type ReactElement, type ReactNode, useId, useMemo } from 'react';
import type { Access, ModuleAccessResult } from '@/lib/access';
import { cx } from './cx';
import styles from './ReasonHint.module.css';

// the project rules and 28: every screen behaves correctly for each role, and an action that is unavailable is
// disabled WITH a reason the person can see. The mockups do it three ways and this file has all three:
//   - `Reason`: only the visible line (icon and text), for a drawer footer where the line sits apart from the button.
//   - `ReasonHint`: wraps a control. With a reason, the control becomes aria-disabled (it stays focusable and never
//     acts), gets the design system tooltip (which also opens on tap, because a touch screen has no hover) and a
//     visible line next to it. With no reason, the control is returned untouched.
//   - `useGate(access)`: the reason for the two gates every screen has, view-only and approve, in the reader's language.

export interface ReasonProps {
  /** The reason, one short line, already in the reader's language. */
  children: ReactNode;
  /** Icon before the text (a lucide element): lock for permission, info for something missing, clock for waiting. */
  icon?: ReactNode;
  id?: string | undefined;
}

export function Reason({ children, icon, id }: ReasonProps) {
  return (
    <span className={styles.reason} id={id}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}

export interface ReasonHintProps {
  /** Why the control is unavailable, in the reader's language. Empty, null or undefined: the control is available. */
  reason: string | null | undefined;
  /** The control: a Button, IconButton, Switch or a link. It must forward `aria-disabled` and `aria-describedby`. */
  children: ReactElement<Record<string, unknown>>;
  /** Writes the reason next to the control as well as in the tooltip. Default true. */
  visible?: boolean | undefined;
  /** Where the visible line goes: after the control (default) or under it. */
  placement?: 'end' | 'below' | undefined;
  /** Icon of the visible line. Default: a lock. */
  icon?: ReactNode;
  /** For a ghost or link control, whose disabled look has no background or border. */
  quiet?: boolean | undefined;
}

export function ReasonHint({ reason, children, visible = true, placement = 'end', icon, quiet = false }: ReasonHintProps) {
  const lineId = useId();
  if (reason === null || reason === undefined || reason === '') return children;

  const own = children.props['aria-describedby'];
  const describedBy = [typeof own === 'string' ? own : undefined, visible ? lineId : undefined].filter(Boolean).join(' ');
  const control = cloneElement(children, {
    'aria-disabled': true,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    // A gated control never acts
    onClick: (event: { preventDefault(): void; stopPropagation(): void }) => {
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return (
    <span className={cx(styles.gate, placement === 'below' && styles.below, quiet && styles.quiet)} data-gated="">
      <Tooltip content={reason}>{control}</Tooltip>
      {visible ? (
        <Reason id={lineId} icon={icon ?? <Lock />}>
          {reason}
        </Reason>
      ) : null}
    </span>
  );
}

/** A gate: whether the control may be used, and if not, why, in the reader's language. */
export interface Gate {
  readonly allowed: boolean;
  /** Null when allowed. Pass it to `ReasonHint`. */
  readonly reason: string | null;
}

export interface Gates {
  /** For a control that changes data: allowed only with 'edit' access. */
  readonly edit: Gate;
  /**
   * For Approve and Reject: allowed only when the person may approve this kind of request. The screen passes what the
   * access model says (approvalKindsFor, checkApproval); this hook does not decide it.
   */
  approve(allowed: boolean): Gate;
}

/**
 * The gates of one module for the current person. `access` is the plain value the screen already has, from the access
 * model: 'edit', 'view' or 'none' (or the whole `ModuleAccessResult`). Anything but 'edit' fails closed.
 */
export function useGate(access: Access | ModuleAccessResult): Gates {
  const t = useTranslations('opendispatch.gate');
  const level = typeof access === 'string' ? access : access.access;
  const viewOnly = t('viewOnly');
  const approveReason = t('approve');
  return useMemo<Gates>(
    () => ({
      edit: level === 'edit' ? { allowed: true, reason: null } : { allowed: false, reason: viewOnly },
      approve: (allowed) => (allowed ? { allowed: true, reason: null } : { allowed: false, reason: approveReason }),
    }),
    [level, viewOnly, approveReason],
  );
}
