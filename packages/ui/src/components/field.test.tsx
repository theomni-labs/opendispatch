// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignSystemProvider } from '../provider';
import { Field, FormFooter, FormGrid, FormSection } from './field';
import { Input } from './input';
import { RadioGroup } from './choice';

afterEach(cleanup);

describe('Field', () => {
  it('names the control by its label and links the hint and the error', () => {
    render(
      <Field label="Name" hint="As on the badge" error="Required">
        <Input name="name" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(['As on the badge', 'Required']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('marks a required field with a hidden star and aria-required, and an optional one with the provider text', () => {
    const { rerender } = render(
      <Field label="Code" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox').getAttribute('aria-required')).toBe('true');
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
    rerender(
      <DesignSystemProvider labels={{ 'field.optional': '(اختياري)' }}>
        <Field label="Code" optional>
          <Input />
        </Field>
      </DesignSystemProvider>,
    );
    expect(screen.getByText('(اختياري)')).toBeTruthy();
  });

  it('names a radio group through aria-labelledby', () => {
    render(
      <Field label="Calendar">
        <RadioGroup name="cal" options={[{ value: 'g', label: 'Gregorian' }]} />
      </Field>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Calendar' })).toBeTruthy();
  });

  it('keeps an id the caller chose', () => {
    render(
      <Field label="City" htmlFor="city">
        <input id="city" />
      </Field>,
    );
    expect(screen.getByLabelText('City').id).toBe('city');
  });
});

describe('FormSection and FormGrid', () => {
  it('is a region named by its heading', () => {
    render(
      <FormSection title="Contact" description="Who we call">
        <FormGrid columns={3}>
          <div data-span="full">x</div>
        </FormGrid>
      </FormSection>,
    );
    expect(screen.getByRole('region', { name: 'Contact' })).toBeTruthy();
    expect(screen.getByText('Who we call')).toBeTruthy();
  });
});

describe('FormFooter', () => {
  it('is a named group with a live status that says when there are unsaved changes', () => {
    const { rerender } = render(
      <FormFooter>
        <button type="submit">Save</button>
      </FormFooter>,
    );
    expect(screen.getByRole('group', { name: 'Form actions' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('No unsaved changes');
    rerender(
      <FormFooter dirty label="Policy actions" status="Saved 10:00">
        <button type="submit">Save</button>
      </FormFooter>,
    );
    expect(screen.getByRole('group', { name: 'Policy actions' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    expect(screen.getByText('Saved 10:00')).toBeTruthy();
  });

  it('submits the form from its action', () => {
    let submitted = 0;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted += 1;
        }}
      >
        <FormFooter>
          <button type="submit">Save</button>
        </FormFooter>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submitted).toBe(1);
  });
});
