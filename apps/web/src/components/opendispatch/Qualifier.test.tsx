// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Qualifier } from './Qualifier';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

describe('Qualifier', () => {
  it('says "inferred" by default, in English and in Arabic', () => {
    inLocale('en', <Qualifier />);
    expect(screen.getByText('inferred')).toBeTruthy();
    cleanup();
    const { container } = inLocale('ar', <Qualifier />);
    expect(screen.getByText('مستنتج')).toBeTruthy();
    expect(hasLatinLetters(readableText(container))).toBe(false);
  });

  it('shows the note it is given instead', () => {
    inLocale('en', <Qualifier>from assignment</Qualifier>);
    expect(screen.getByText('from assignment')).toBeTruthy();
    expect(screen.queryByText('inferred')).toBeNull();
  });

  it('shows the info icon only when asked, and hides it from assistive technology', () => {
    const plain = inLocale('en', <Qualifier />);
    expect(plain.container.querySelector('svg')).toBeNull();
    cleanup();
    const withIcon = inLocale('en', <Qualifier icon />);
    expect(withIcon.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('sits inline next to a value', () => {
    const { container } = inLocale(
      'en',
      <p>
        Field <Qualifier />
      </p>,
    );
    expect(container.querySelector('p')?.textContent).toBe('Field inferred');
  });
});
