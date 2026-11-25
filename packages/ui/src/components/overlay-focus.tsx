// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogFocusProps {
  /** Called on Escape pressed inside the dialog, unless something inside handled it first. */
  onClose: () => void;
  /** Id of the title heading, set as aria-labelledby on the dialog. */
  labelledBy: string;
  /** Id of the description, set as aria-describedby on the dialog. */
  describedBy?: string | undefined;
  /** Where focus goes when the dialog opens: the marked or first control, or the close button. */
  initialFocus?: 'content' | 'close';
}

/**
 * Rendered inside an Ant Design Modal or Drawer while it is open. It names the dialog by its title heading only,
 * sets aria-describedby, closes on Escape (by `key`, so a nested control that handles Escape and prevents the
 * default keeps the dialog open), and moves focus to the element marked `data-autofocus` (or `autofocus`), else the
 * first control that is not the close button, else the close button. Focus goes back to where it was on close.
 */
export function DialogFocus({ onClose, labelledBy, describedBy, initialFocus = 'content' }: DialogFocusProps) {
  const marker = useRef<HTMLSpanElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = marker.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    dialog.setAttribute('aria-labelledby', labelledBy);
    if (describedBy) dialog.setAttribute('aria-describedby', describedBy);
    else dialog.removeAttribute('aria-describedby');
    const close = dialog.querySelector<HTMLElement>('.ant-modal-close, .ant-drawer-close');
    close?.setAttribute('data-dialog-close', '');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    let target: HTMLElement | null = null;
    if (initialFocus === 'close' && close) target = close;
    target ??= dialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
    target ??=
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).find((element) => element !== close && !close?.contains(element)) ??
      close ??
      dialog;
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const inside = event.target instanceof Node && dialog.contains(event.target);
      if (!inside) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [labelledBy, describedBy, initialFocus]);

  return <span ref={marker} hidden />;
}

/**
 * Overlays render straight into <body>. Ant Design's default container is attached to the page only after the
 * dialog's own effects ran, so focus could not be moved in the same commit.
 */
export function bodyContainer(): HTMLElement {
  return document.body;
}
