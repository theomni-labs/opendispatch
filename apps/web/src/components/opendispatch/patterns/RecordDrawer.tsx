'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Alert, Drawer } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useUrlState } from './useUrlState';

// A detail or edit drawer whose state is the address bar. The server decides whether the
// record in `?id=` exists and passes `open`, so a deep link paints the drawer on first paint; closing (the X, Escape,
// the scrim) removes the parameter with `router.replace` and the drawer disappears at once, before the server answers.
// Focus returns to what had it (the design system's Drawer). The body and the footer are the module's client code:
//
//   <RecordDrawer open={user !== undefined} recordKey={user?.id} title={<span translate="no">{user.name}</span>} subtitle={...} footer={...}>
//     <DescriptionList ... />
//   </RecordDrawer>
//
// An unknown or malformed id is not a drawer: the screen shows <RecordNotice /> above the list instead.

export interface RecordDrawerProps {
  /** True when the parameter names a record that exists. Decided on the server. */
  readonly open: boolean;
  /** Identifies the record shown; a new key reopens a drawer the person had closed. */
  readonly recordKey?: string | undefined;
  /** The search parameter that holds the open record. Default `id`. */
  readonly param?: string | undefined;
  /** Other parameters removed on close (a `new=1` flag). */
  readonly closeAlso?: readonly string[] | undefined;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: number | undefined;
  /** Runs after the parameter is removed. */
  readonly onClosed?: (() => void) | undefined;
  readonly children?: ReactNode;
}

export function RecordDrawer({ open, recordKey, param = 'id', closeAlso = [], title, subtitle, footer, width, onClosed, children }: RecordDrawerProps) {
  const url = useUrlState();
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  const key = recordKey ?? '';
  // A drawer the person closed stays closed until the server stops sending it or sends another record.
  if (!open && dismissed !== undefined) setDismissed(undefined);
  const hidden = open && dismissed === key;

  return (
    <Drawer
      open={open && !hidden}
      onClose={() => {
        setDismissed(key);
        url.update({ [param]: null, ...Object.fromEntries(closeAlso.map((other) => [other, null])) }, { keepPage: true });
        onClosed?.();
      }}
      title={title}
      subtitle={subtitle}
      footer={footer}
      {...(width === undefined ? {} : { width })}
    >
      {children}
    </Drawer>
  );
}

export interface RecordNoticeProps {
  /** The parameter to remove when the notice is dismissed. Default `id`. */
  readonly param?: string | undefined;
  /** The module's own line, for example "That user could not be found." Default: the generic one. */
  readonly message?: string | undefined;
}

/** The inline notice for an unknown or malformed record id: the list shows as usual, never a 500. */
export function RecordNotice({ param = 'id', message }: RecordNoticeProps) {
  const t = useTranslations('patterns.notice');
  const url = useUrlState();
  return (
    <Alert tone="warning" onDismiss={() => url.update({ [param]: null }, { keepPage: true })}>
      {message ?? t('recordNotFound')}
    </Alert>
  );
}
