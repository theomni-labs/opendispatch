// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { patternName, patternShortName } from './types';

describe('patternName', () => {
  const row = { name: 'Evening (Ramadan only)', nameAr: 'مسائي (رمضان فقط)' };

  it('uses the Arabic name in Arabic and the English one otherwise', () => {
    expect(patternName(row, 'ar')).toBe('مسائي (رمضان فقط)');
    expect(patternName(row, 'en')).toBe('Evening (Ramadan only)');
    expect(patternName({ name: 'Day C', nameAr: null }, 'ar')).toBe('Day C');
  });

  it('drops the Ramadan note in the legends', () => {
    expect(patternShortName(row, 'ar')).toBe('مسائي');
    expect(patternShortName(row, 'en')).toBe('Evening');
  });
});
