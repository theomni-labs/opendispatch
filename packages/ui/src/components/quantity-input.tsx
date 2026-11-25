// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Input as AntInput, Space } from 'antd';
import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useLabels } from '../provider';
import { useFormat } from '../provider/use-format';
import { cx } from '../types';
import styles from './quantity-input.module.css';
import { ANT_SIZE, defined } from './form-utils';

export interface QuantityInputProps {
  value?: number | undefined;
  defaultValue?: number | undefined;
  /** Called with the new number when a step button is pressed, or when typing is committed (blur or Enter). */
  onChange?: ((value: number) => void) | undefined;
  step?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  /** The unit shown after the number ("min", "kg"), also read out with the value. */
  uom?: string | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | 'true' | 'false' | undefined;
}


/** Arabic-Indic digits and separators typed on an Arabic keyboard, read as Western ones. */
function westernDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (char === '٫') out += '.';
    else if (char !== '٬' && char !== ',') out += char;
  }
  return out;
}

const roundTo3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * A number with minus and plus buttons, on Ant Design's Input and Button. The field is a spinbutton: arrow keys
 * step, typing is held as a draft and committed on blur or Enter (Escape puts the value back), and the value is
 * kept between min and max.
 */
export function QuantityInput({
  value,
  defaultValue,
  onChange,
  step = 1,
  min,
  max,
  uom,
  size = 'md',
  id,
  name,
  disabled = false,
  invalid = false,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: QuantityInputProps) {
  const label = useLabels();
  const { formatNumber } = useFormat();
  const shown = (n: number) => formatNumber(n, { maximumFractionDigits: 3 });
  const [own, setOwn] = useState<number>(defaultValue ?? min ?? 0);
  const current = value === undefined ? own : value;
  const [draft, setDraft] = useState<string | null>(null);
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true';

  function bounded(n: number): number {
    let next = roundTo3(n);
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    return next;
  }

  function commit(n: number): number {
    const next = bounded(n);
    if (value === undefined) setOwn(next);
    if (next !== current) onChange?.(next);
    return next;
  }

  function draftNumber(): number {
    if (draft === null) return current;
    const n = Number.parseFloat(draft);
    return Number.isFinite(n) ? n : current;
  }

  function stepBy(direction: 1 | -1) {
    const next = commit(draftNumber() + direction * step);
    if (draft !== null) setDraft(String(next));
  }

  function onType(event: ChangeEvent<HTMLInputElement>) {
    const text = westernDigits(event.target.value);
    if (/^-?\d*\.?\d*$/.test(text)) setDraft(text);
  }

  function onBlur() {
    if (draft !== null && draft.trim() !== '' && draft !== '-' && draft !== '.') commit(draftNumber());
    setDraft(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(event.key === 'ArrowUp' ? 1 : -1);
    } else if (event.key === 'Enter' && draft !== null) {
      setDraft(String(commit(draftNumber())));
    } else if (event.key === 'Escape' && draft !== null) {
      setDraft(String(current));
    }
  }

  const atMin = min !== undefined && current <= min;
  const atMax = max !== undefined && current >= max;
  const antSize = ANT_SIZE[size];

  return (
    <Space.Compact {...defined({ className: cx(styles.quantity, className) })} size={antSize}>
      <Button
        tabIndex={-1}
        icon={<MinusOutlined aria-label="" aria-hidden="true" />}
        aria-label={label('quantityInput.decrease')}
        disabled={disabled || atMin}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => stepBy(-1)}
      />
      <AntInput
        {...defined({
          id,
          name,
          status: isInvalid ? ('error' as const) : undefined,
          'aria-valuemin': min,
          'aria-valuemax': max,
          'aria-valuetext': uom ? `${shown(current)} ${uom}` : undefined,
          'aria-label': ariaLabel,
          'aria-describedby': ariaDescribedBy,
          'aria-invalid': isInvalid || undefined,
          suffix: uom ? <span aria-hidden="true">{uom}</span> : undefined,
        })}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        autoComplete="off"
        disabled={disabled}
        value={draft ?? shown(current)}
        aria-valuenow={current}
        className={styles.field}
        onFocus={(event) => {
          setDraft(String(current));
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onChange={onType}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      <Button
        tabIndex={-1}
        icon={<PlusOutlined aria-label="" aria-hidden="true" />}
        aria-label={label('quantityInput.increase')}
        disabled={disabled || atMax}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => stepBy(1)}
      />
    </Space.Compact>
  );
}
