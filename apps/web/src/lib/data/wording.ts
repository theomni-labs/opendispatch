// SPDX-License-Identifier: AGPL-3.0-only
// Customer short name in screen text (install)

import { DEFAULT_CUSTOMER_SHORT_NAME, pickCustomerShortName } from '@/i18n/message-tree';

/** The messages' {customer}; no ctx, like isOidcMode. */
export function customerShortName(locale: string): string {
  return pickCustomerShortName(locale, process.env['OPENDISPATCH_CUSTOMER_SHORT_NAME'], process.env['OPENDISPATCH_CUSTOMER_SHORT_NAME_AR']);
}

/** The customer's case-type names, and neutral ones. */
const CASE_TYPES = [
  { name: 'Police attended', en: 'Traffic police case', ar: 'بلاغ بحضور المرور' },
  { name: 'Standard case', en: 'Standard case', ar: 'بلاغ اعتيادي' },
  { name: 'Unlisted', en: 'Non-standard case', ar: 'بلاغ غير اعتيادي' },
] as const;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CASE_TYPE_TEXT = CASE_TYPES.map((t) => ({ ...t, pattern: new RegExp(`\\b${escape(t.name)}(?:\\s*([Cc]ases?)\\b)?`, 'g') }));

/** @pure Another customer than the customer: neutral names. */
export function isNeutralWording(customerEn: string): boolean {
  return customerEn.trim().toLowerCase() !== DEFAULT_CUSTOMER_SHORT_NAME.en.toLowerCase();
}

/** @pure Case type display name; code stays. */
export function neutralCaseTypeName(name: string, locale: string, customerEn: string): string {
  if (!isNeutralWording(customerEn)) return name;
  const known = CASE_TYPES.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  return known === undefined ? name : locale === 'ar' ? known.ar : known.en;
}

/** @pure English record text without the customer's names. */
export function neutralText(text: string, customerEn: string): string {
  if (!isNeutralWording(customerEn)) return text;
  let out = text;
  for (const t of CASE_TYPE_TEXT) out = out.replace(t.pattern, (_all: string, suffix?: string) => (suffix?.toLowerCase() === 'cases' ? `${t.en}s` : t.en));
  return out.replace(/\b(?:Customer|[Tt]he operator|Operator)\b/g, customerEn.trim());
}

/** A case type's name on screen (install setting). */
export function caseTypeName(name: string, locale: string): string {
  return neutralCaseTypeName(name, locale, customerShortName('en'));
}

/** Record text with the install's customer name. */
export function customerText(text: string): string {
  return neutralText(text, customerShortName('en'));
}
