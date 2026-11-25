// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IllustrativeLabel } from './IllustrativeLabel';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

describe('IllustrativeLabel', () => {
  it('reads Illustrative in English and توضيحي in Arabic', () => {
    inLocale('en', <IllustrativeLabel />);
    expect(screen.getByText('Illustrative')).toBeTruthy();
    cleanup();
    const { container } = inLocale('ar', <IllustrativeLabel />);
    expect(screen.getByText('توضيحي')).toBeTruthy();
    expect(hasLatinLetters(readableText(container))).toBe(false);
  });

  it('is plain inline text, so it can sit right after a number and be read with it', () => {
    const { container } = inLocale(
      'en',
      <p>
        <span>49%</span> <IllustrativeLabel />
      </p>,
    );
    expect(container.querySelector('p')?.textContent).toBe('49% Illustrative');
  });
});
