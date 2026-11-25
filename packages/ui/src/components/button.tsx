// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Button as AntButton, type ButtonProps as AntButtonProps } from 'antd';
import { createElement, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { useLink } from '../provider';
import { cx as joinClasses } from '../types';
import styles from './button.module.css';

/** Class names for Ant Design props, which take a string, not undefined. */
const cx = (...names: Array<string | false | null | undefined>): string => joinClasses(...names) ?? '';

export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'link';

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

const SIZE: Record<ButtonSize, AntButtonProps['size']> = { sm: 'small', md: 'middle', lg: 'large' };

/** How each variant looks in Ant Design terms. */
const LOOK: Record<ButtonVariant, Pick<AntButtonProps, 'color' | 'variant'>> = {
  primary: { color: 'primary', variant: 'solid' },
  secondary: { color: 'default', variant: 'outlined' },
  ghost: { color: 'default', variant: 'text' },
  accent: { color: 'primary', variant: 'filled' },
  danger: { color: 'danger', variant: 'solid' },
  link: { color: 'primary', variant: 'link' },
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className={styles.icon} aria-hidden="true">
      {children}
    </span>
  );
}

const SPINNER = (
  <Glyph>
    <LoadingOutlined aria-hidden="true" aria-label="" spin />
  </Glyph>
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon on the inline-start side. */
  startIcon?: ReactNode;
  /** Icon on the inline-end side, hidden while loading. */
  endIcon?: ReactNode;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Renders the provider's link component, styled as a button. */
  href?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** A real <button> on Ant Design's Button, or a link that looks like one when `href` is given. */
export function Button({
  variant = 'secondary',
  size = 'md',
  startIcon,
  endIcon,
  loading = false,
  fullWidth = false,
  href,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const Link = useLink();
  const inactive = Boolean(disabled || loading);
  const hasLabel = children !== null && children !== undefined && children !== false;
  const label = hasLabel ? <span className={styles.label}>{children}</span> : null;
  const end = endIcon && !loading ? <Glyph>{endIcon}</Glyph> : null;

  if (href && !inactive) {
    return (
      createElement(
        Link,
        { ...(rest as AnchorProps), href, className: cx(styles.anchor, styles[variant], styles[size], fullWidth && styles.block, className) },
        startIcon ? <Glyph>{startIcon}</Glyph> : null,
        label,
        end,
      )
    );
  }

  return (
    <AntButton
      {...(rest as Omit<AntButtonProps, 'type'>)}
      {...LOOK[variant]}
      {...(ref ? { ref } : {})}
      htmlType={type}
      size={SIZE[size]}
      block={fullWidth}
      disabled={inactive}
      loading={loading ? { icon: SPINNER } : false}
      icon={startIcon && !loading ? <Glyph>{startIcon}</Glyph> : undefined}
      aria-busy={loading || undefined}
      className={cx(styles.button, className)}
    >
      {label}
      {end}
    </AntButton>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** The accessible name, also shown as the title. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'primary';
  size?: ButtonSize;
  href?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** A square button with only an icon; `label` names it. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  href,
  className,
  disabled,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const Link = useLink();
  if (href && !disabled) {
    return (
      createElement(
        Link,
        {
          title: label,
          ...(rest as AnchorProps),
          href,
          'aria-label': label,
          className: cx(styles.anchor, styles.iconOnly, styles[variant], styles[size], className),
        },
        <Glyph>{icon}</Glyph>,
      )
    );
  }
  return (
    <AntButton
      title={label}
      {...(rest as Omit<AntButtonProps, 'type'>)}
      {...LOOK[variant]}
      {...(ref ? { ref } : {})}
      htmlType={type}
      size={SIZE[size]}
      {...(disabled === undefined ? {} : { disabled })}
      icon={<Glyph>{icon}</Glyph>}
      aria-label={label}
      className={cx(className)}
    />
  );
}
