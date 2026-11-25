// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { ExclamationCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Children, cloneElement, isValidElement, useId, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { useLabels } from '../provider';
import { cx } from '../types';
import styles from './field.module.css';

/* Field: a label, the control, an error and a hint, wired together for assistive technology. */

export interface FieldProps {
  label: string;
  /** The id of the control. Default: a generated id, given to the single child. */
  htmlFor?: string | undefined;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean | undefined;
  optional?: boolean | undefined;
  /** Shown at the end of the label row, such as a help link. */
  labelAction?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

export type FieldRootAttributes = Omit<HTMLAttributes<HTMLDivElement>, 'children' | keyof FieldProps>;

interface WiredProps {
  id?: string;
  role?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

// Elements a <label for> can name. Anything else (a component, or an element with a role) is named by aria-labelledby.
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);

function wire(child: ReactElement<WiredProps>, ids: { control: string; label: string }, describedBy: string | undefined, error: boolean, required: boolean) {
  const own = child.props;
  const extra: WiredProps = {};
  if (!own.id) extra.id = ids.control;
  if (describedBy) extra['aria-describedby'] = own['aria-describedby'] ? `${own['aria-describedby']} ${describedBy}` : describedBy;
  if (error) extra['aria-invalid'] = true;
  if (required && own['aria-required'] === undefined) extra['aria-required'] = true;
  const native = typeof child.type === 'string';
  const needsName = native ? !LABELABLE.has(child.type as string) && Boolean(own.role) : true;
  const named = Boolean(own['aria-label'] || own['aria-labelledby']);
  const pointsHere = !own.id || own.id === ids.control;
  if (needsName && !named && pointsHere) extra['aria-labelledby'] = ids.label;
  return cloneElement(child, extra);
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  optional = false,
  labelAction,
  className,
  children,
  ...rest
}: FieldProps & FieldRootAttributes) {
  const text = useLabels();
  const generated = useId();
  const controlId = htmlFor ?? `field-${generated}`;
  const ids = { control: controlId, label: `${controlId}-label` };
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const single = Children.count(children) === 1 && isValidElement(children);
  const control = single ? wire(children as ReactElement<WiredProps>, ids, describedBy, Boolean(error), required) : children;

  return (
    <div {...rest} className={cx(styles.field, className)}>
      <div className={styles.labelRow}>
        <label htmlFor={controlId} id={ids.label} className={styles.label}>
          {label}
          {required ? (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          ) : null}
          {optional && !required ? <span className={styles.optional}>{text('field.optional')}</span> : null}
        </label>
        {labelAction ? <div className={styles.labelAction}>{labelAction}</div> : null}
      </div>
      {control}
      {error ? (
        <p id={errorId} className={styles.error}>
          <ExclamationCircleOutlined aria-label="" aria-hidden="true" className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* FormSection: a titled region of a long form, the title and description beside the fields. */

export interface FormSectionProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

export function FormSection({ title, description, actions, className, children }: FormSectionProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(styles.section, className)}>
      <div className={styles.sectionAside}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {title}
        </h2>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </div>
      <div className={styles.sectionContent}>{children}</div>
    </section>
  );
}

/* FormGrid: fields in one to four columns. A child with data-span="full" takes the whole row. */

export interface FormGridProps {
  columns?: 1 | 2 | 3 | 4 | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function FormGrid({ columns = 2, className, children }: FormGridProps) {
  return <div className={cx(styles.grid, styles[`cols${String(columns)}`], className)}>{children}</div>;
}

/* FormFooter: the action bar of a form, with a live "unsaved changes" status. */

export interface FormFooterProps {
  status?: ReactNode;
  dirty?: boolean | undefined;
  /** The group's name. Default: the "formFooter.label" label. */
  label?: string | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

export function FormFooter({ status, dirty = false, label: name, className, children }: FormFooterProps) {
  const text = useLabels();
  return (
    <div role="group" aria-label={name ?? text('formFooter.label')} className={cx(styles.footer, className)}>
      <div className={styles.footerStart}>
        {/* Always rendered, so a change is announced. The clean state is read, not shown. */}
        <span role="status" aria-live="polite" aria-atomic="true">
          {dirty ? (
            <span className={styles.unsaved}>
              <InfoCircleOutlined aria-label="" aria-hidden="true" />
              {text('formFooter.unsaved')}
            </span>
          ) : (
            <span className={styles.visuallyHidden}>{text('formFooter.clean')}</span>
          )}
        </span>
        {status ? <span className={styles.footerStatus}>{status}</span> : null}
      </div>
      {children ? <div className={styles.footerActions}>{children}</div> : null}
    </div>
  );
}
