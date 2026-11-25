// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { DEMO_INSTANT, previewRows } from './preview';
import { DEFAULT_SETTINGS } from './types';

// loadLocalizationView is api-backed: it moved to
// view.live.test.ts. previewRows is pure.

describe('previewRows (illustrative: the browser\'s Intl, not the application\'s formatter)', () => {
  it('writes the demo Sunday in English under the defaults: Gregorian first with the Hijri date beside it, Western digits', () => {
    const rows = previewRows('en', DEFAULT_SETTINGS);
    expect(DEMO_INSTANT).toBe('2026-09-13T10:42:00+03:00');
    expect(rows.date).toMatch(/^13 Sept? 2026 · /);
    expect(rows.datetime).toContain('13 September 2026');
    expect(rows.datetime).toContain('10:42');
    expect(rows.number).toBe('1,234,567.8');
    expect(rows.percent).toBe('49%');
    expect(rows.time).toBe('10:42');
    expect(rows.week).toBe('Sunday');
  });

  it('writes Arabic with Western digits by default, and Arabic-Indic digits only when that option is chosen', () => {
    expect(previewRows('ar', DEFAULT_SETTINGS).number).toMatch(/^[0-9,.٬٫]+$/);
    expect(/[٠-٩]/.test(previewRows('ar', DEFAULT_SETTINGS).number)).toBe(false);
    const indic = previewRows('ar', { ...DEFAULT_SETTINGS, digit_system: 'arabic_indic' });
    expect(/[٠-٩]/.test(indic.number)).toBe(true);
    expect(/[٠-٩]/.test(indic.time)).toBe(true);
    // the English preview keeps Western digits whatever the option says
    expect(/[٠-٩]/.test(previewRows('en', { ...DEFAULT_SETTINGS, digit_system: 'arabic_indic' }).number)).toBe(false);
  });

  it('puts the Hijri calendar first when it is the primary one, and leaves the secondary date out when asked', () => {
    const hijri = previewRows('en', { ...DEFAULT_SETTINGS, primary_calendar: 'hijri' });
    expect(hijri.date).toMatch(/1448.* · 13 Sept? 2026$/);
    expect(hijri.date).not.toMatch(/^13 Sept? 2026/);
    expect(previewRows('en', { ...DEFAULT_SETTINGS, show_secondary_calendar: false }).date).not.toContain('·');
  });

  it('names the first day of the week that was chosen, in the language previewed', () => {
    expect(previewRows('en', { ...DEFAULT_SETTINGS, first_day_of_week: 'saturday' }).week).toBe('Saturday');
    expect(previewRows('en', { ...DEFAULT_SETTINGS, first_day_of_week: 'monday' }).week).toBe('Monday');
    expect(previewRows('ar', { ...DEFAULT_SETTINGS, first_day_of_week: 'saturday' }).week).toBe('السبت');
  });
});
