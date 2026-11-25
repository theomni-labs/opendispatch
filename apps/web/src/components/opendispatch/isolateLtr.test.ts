// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isolateLtr } from './isolateLtr';

describe('isolateLtr', () => {
  it('wraps the text in a left-to-right isolate', () => {
    expect(isolateLtr('95%')).toBe('⁦95%⁩');
  });
});
