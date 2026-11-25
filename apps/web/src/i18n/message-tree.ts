// SPDX-License-Identifier: AGPL-3.0-only
// A message tree and the two helpers on it that both the server loader (messages.ts) and the client provider
// (ModuleMessages.tsx) need. Pure and small on purpose: a client file may import this one, but never messages.ts, which
// holds every module's messages (a test guards that, messages-loader.test.ts).

export type Messages = { [key: string]: string | Messages };

const isTree = (value: string | Messages | undefined): value is Messages => typeof value === 'object' && value !== null;

/** A new tree with `extra` laid over `base`, level by level. Neither argument changes. A string in `extra` wins. */
export function mergeMessages(base: Messages, extra: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = out[key];
    out[key] = isTree(existing) && isTree(value) ? mergeMessages(existing, value) : value;
  }
  return out;
}

/** @pure Text as an ICU literal (quotes specials). */
export function icuLiteral(text: string): string {
  return text.replace(/'/g, "''").replace(/[{}]/g, (c) => `'${c}'`);
}

const CUSTOMER = /\{customer\}/g;

/** The operator's short names when the install sets none. */
export const DEFAULT_CUSTOMER_SHORT_NAME = { en: 'operator', ar: 'المشغّل' } as const;

/** @pure Blank is unset; Arabic falls back to English. */
export function pickCustomerShortName(locale: string, en: string | undefined, ar: string | undefined): string {
  const enName = en?.trim() ?? '';
  const arName = ar?.trim() ?? '';
  if (locale === 'ar') return arName !== '' ? arName : enName !== '' ? enName : DEFAULT_CUSTOMER_SHORT_NAME.ar;
  return enName !== '' ? enName : DEFAULT_CUSTOMER_SHORT_NAME.en;
}

/** True when a placeholder at `offset` starts a sentence: the text start, an ICU branch start, or after ". ". */
function startsSentence(text: string, offset: number): boolean {
  const before = text.slice(0, offset).trimEnd();
  return before === '' || before.endsWith('{') || before.endsWith('.') || before.endsWith(':');
}

/** @pure A copy with every {customer} set to `name`, capitalised where it starts a sentence. */
export function fillCustomer(tree: Messages, name: string): Messages {
  const literal = icuLiteral(name);
  const capital = icuLiteral(name.charAt(0).toUpperCase() + name.slice(1));
  const out: Messages = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] =
      typeof value === 'string'
        ? value.replace(CUSTOMER, (_match: string, offset: number) => (startsSentence(value, offset) ? capital : literal))
        : fillCustomer(value, name);
  }
  return out;
}

/** Every leaf of a tree as `dotted.path -> text`, for example `nav.admin.users_roles.title`. */
export function messageLeaves(tree: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, messageLeaves(value, path));
  }
  return out;
}
