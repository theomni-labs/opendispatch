// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickCustomerShortName } from '@/i18n/message-tree';
import { caseTypeName, customerShortName, customerText, neutralCaseTypeName, neutralText } from './wording';

describe('pickCustomerShortName', () => {
  it('is operator in both languages when nothing is set', () => {
    expect(pickCustomerShortName('en', undefined, undefined)).toBe('operator');
    expect(pickCustomerShortName('ar', undefined, undefined)).toBe('المشغّل');
    expect(pickCustomerShortName('en', '  ', '')).toBe('operator');
  });

  it('takes the neutral names when set', () => {
    expect(pickCustomerShortName('en', 'Operator', 'المشغّل')).toBe('Operator');
    expect(pickCustomerShortName('ar', 'Operator', 'المشغّل')).toBe('المشغّل');
  });

  it('gives Arabic the English name when only that is set', () => {
    expect(pickCustomerShortName('ar', 'Operator', undefined)).toBe('Operator');
  });
});

describe('customerShortName', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the two settings from the environment', () => {
    vi.stubEnv('OPENDISPATCH_CUSTOMER_SHORT_NAME', 'Operator');
    vi.stubEnv('OPENDISPATCH_CUSTOMER_SHORT_NAME_AR', 'المشغّل');
    expect(customerShortName('en')).toBe('Operator');
    expect(customerShortName('ar')).toBe('المشغّل');
  });
});

describe('neutralCaseTypeName', () => {
  it('keeps Customer names on a default install', () => {
    expect(neutralCaseTypeName('Unlisted', 'en', 'operator')).toBe('Unlisted');
    expect(neutralCaseTypeName('Standard case', 'ar', 'operator')).toBe('Standard case');
  });

  it('maps every standard case type when neutral', () => {
    expect(neutralCaseTypeName('Standard case', 'en', 'Acme Response')).toBe('Standard case');
    expect(neutralCaseTypeName('Police attended', 'en', 'Acme Response')).toBe('Traffic police case');
    expect(neutralCaseTypeName('Unlisted', 'en', 'Acme Response')).toBe('Non-standard case');
  });

  it('gives Arabic names when neutral', () => {
    expect(neutralCaseTypeName('Standard case', 'ar', 'Acme Response')).toBe('بلاغ اعتيادي');
    expect(neutralCaseTypeName('Police attended', 'ar', 'Acme Response')).toBe('بلاغ بحضور المرور');
    expect(neutralCaseTypeName('Unlisted', 'ar', 'Acme Response')).toBe('بلاغ غير اعتيادي');
  });

  it('leaves an unknown case type as it is', () => {
    expect(neutralCaseTypeName('Hit and run', 'en', 'Acme Response')).toBe('Hit and run');
  });
});

describe('neutralText', () => {
  it('is unchanged on a default install', () => {
    const text = 'Assigned 2 minutes before it was registered (Unlisted case).';
    expect(neutralText(text, 'operator')).toBe(text);
  });

  it('rewrites case types and the name when neutral', () => {
    expect(neutralText('Assigned 2 minutes before it was registered (Unlisted case).', 'Acme Response')).toBe('Assigned 2 minutes before it was registered (Non-standard case).');
    expect(neutralText('1 parties involved. Meaning to be confirmed by the operator.', 'Acme Response')).toBe('1 parties involved. Meaning to be confirmed by Acme Response.');
    expect(neutralText('Unlisted cases always go to the field.', 'Acme Response')).toBe('Non-standard cases always go to the field.');
    expect(neutralText('Unlisted: field mandatory', 'Acme Response')).toBe('Non-standard case: field mandatory');
    expect(neutralText('Case type Police attended', 'Acme Response')).toBe('Case type Traffic police case');
    expect(neutralText('Operator case feed (simulator)', 'Acme Response')).toBe('Acme Response case feed (simulator)');
  });
});

describe('caseTypeName and customerText', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('are unchanged with no setting', () => {
    vi.stubEnv('OPENDISPATCH_CUSTOMER_SHORT_NAME', '');
    expect(caseTypeName('Unlisted', 'ar')).toBe('Unlisted');
    expect(customerText('by the operator')).toBe('by the operator');
  });

  it('follow the neutral setting', () => {
    vi.stubEnv('OPENDISPATCH_CUSTOMER_SHORT_NAME', 'Acme Response');
    expect(caseTypeName('Unlisted', 'ar')).toBe('بلاغ غير اعتيادي');
    expect(customerText('by Customer')).toBe('by Acme Response');
  });
});
