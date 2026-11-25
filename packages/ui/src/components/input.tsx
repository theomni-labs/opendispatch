// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { Input as AntInput } from 'antd';
import type { InputRef } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useCallback, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { cx } from '../types';
import { ANT_SIZE, assignRef, defined } from './form-utils';
import styles from './input.module.css';

/** Hands a DOM node to a callback ref or an object ref. */

function ariaTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'sm' | 'md' | 'lg' | undefined;
  /** Text or a node before the value, inside the control (a currency, a unit). */
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** A decorative icon at the start. */
  startIcon?: ReactNode;
  invalid?: boolean | undefined;
  ref?: Ref<HTMLInputElement>;
}

/** A text input on Ant Design's Input. Every native attribute (name, id, aria-*) reaches the <input>. */
export function Input({ size = 'md', prefix, suffix, startIcon, invalid = false, className, ref, ...rest }: InputProps) {
  const isInvalid = invalid || ariaTrue(rest['aria-invalid']);
  const setRef = useCallback((instance: InputRef | null) => assignRef(ref, instance?.input ?? null), [ref]);
  const start =
    startIcon || (prefix !== undefined && prefix !== null) ? (
      <>
        {startIcon ? (
          <span className={styles.icon} aria-hidden="true">
            {startIcon}
          </span>
        ) : null}
        {prefix !== undefined && prefix !== null ? <span className={styles.affix}>{prefix}</span> : null}
      </>
    ) : undefined;
  const end = suffix !== undefined && suffix !== null ? <span className={styles.affix}>{suffix}</span> : undefined;
  // Ant Design types `onChange` and friends for its own wrapper; the handlers receive the <input> events unchanged.
  const native = rest as Record<string, unknown>;
  return (
    <AntInput
      {...native}
      ref={setRef}
      size={ANT_SIZE[size]}
      {...defined({
        status: isInvalid ? ('error' as const) : undefined,
        'aria-invalid': isInvalid || undefined,
        prefix: start,
        suffix: end,
        className: cx(styles.input, className),
      })}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean | undefined;
  ref?: Ref<HTMLTextAreaElement>;
}

/** A multi-line text input on Ant Design's TextArea. Three rows unless told otherwise. */
export function Textarea({ invalid = false, className, rows = 3, ref, ...rest }: TextareaProps) {
  const isInvalid = invalid || ariaTrue(rest['aria-invalid']);
  const setRef = useCallback(
    (instance: TextAreaRef | null) => assignRef(ref, instance?.resizableTextArea?.textArea ?? null),
    [ref],
  );
  const native = rest as Record<string, unknown>;
  return (
    <AntInput.TextArea
      {...native}
      ref={setRef}
      rows={rows}
      {...defined({
        status: isInvalid ? ('error' as const) : undefined,
        'aria-invalid': isInvalid || undefined,
        className: cx(styles.textarea, className),
      })}
    />
  );
}
