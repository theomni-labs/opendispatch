'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { Button, IconButton, useToast } from '@opendispatch/ui';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';

// Copies a value to the clipboard and says so with a toast: the API key, the audit event as JSON, the
// firewall hostnames, the sign-in reference code. With `label` shown it is a small button with text; without, an icon
// button named by `label` for a screen reader. The clipboard needs a secure context (https or localhost); where it is
// missing or refuses, the toast says "Could not copy" and nothing else changes. The value is never logged or stored.

export interface CopyButtonProps {
  /** What is copied. */
  readonly value: string;
  /** The button's name: visible text, or the accessible name of the icon button. Default: "Copy". */
  readonly label?: string | undefined;
  /** Show the label as text next to the icon. */
  readonly showLabel?: boolean | undefined;
  readonly variant?: 'ghost' | 'secondary' | undefined;
  /** What the "Copied" toast says under its title (for example the name of the value). */
  readonly description?: string | undefined;
}

export function CopyButton({ value, label, showLabel = false, variant = 'ghost', description }: CopyButtonProps) {
  const t = useTranslations('patterns.copy');
  const toast = useToast();
  const name = label ?? t('copy');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: t('copied'), ...(description === undefined ? {} : { description }), tone: 'success' });
    } catch {
      toast({ title: t('failed'), tone: 'danger' });
    }
  }

  return showLabel ? (
    <Button variant={variant} size="sm" startIcon={<Copy />} onClick={copy}>
      {name}
    </Button>
  ) : (
    <IconButton icon={<Copy />} label={name} variant={variant} size="sm" onClick={copy} />
  );
}
