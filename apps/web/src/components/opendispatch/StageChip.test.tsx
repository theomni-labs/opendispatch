// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StageChip } from './StageChip';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

describe('StageChip', () => {
  it.each([
    ['shadow', 'Shadow'],
    ['recommend', 'Recommend'],
    ['automatic', 'Automatic'],
  ] as const)('shows the zone and the %s stage in English', (stage, text) => {
    const { container } = inLocale('en', <StageChip zone="RD-C" stage={stage} />);
    expect(screen.getByText('RD-C')).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    expect(container.firstElementChild?.firstElementChild?.getAttribute('data-stage')).toBe(stage);
  });

  it.each([
    ['shadow', 'التشغيل الظلّي'],
    ['recommend', 'التوصية'],
    ['automatic', 'التلقائي'],
  ] as const)('shows the %s stage in Arabic, with only the zone code in Latin letters', (stage, text) => {
    const { container } = inLocale('ar', <StageChip zone="JD-N" stage={stage} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(hasLatinLetters(readableText(container), ['JD-N'])).toBe(false);
  });

  it('keeps the zone code untranslated and gives each stage its own icon, hidden from assistive technology', () => {
    const icons = new Set<string>();
    for (const stage of ['shadow', 'recommend', 'automatic'] as const) {
      const { container } = inLocale('en', <StageChip zone="RD-C" stage={stage} />);
      expect(screen.getByText('RD-C').getAttribute('translate')).toBe('no');
      const icon = container.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      icons.add(icon?.getAttribute('class') ?? '');
      cleanup();
    }
    // Colour is the stage's tone; the icon and the word say the same thing, so no stage relies on colour alone.
    expect(icons.size).toBe(3);
  });

  it('is plain read-only text, not a control (the stage is a setting, the project rules)', () => {
    const { container } = inLocale('en', <StageChip zone="RD-C" stage="recommend" />);
    expect(container.querySelector('button, a, input, [tabindex]')).toBeNull();
  });
});
