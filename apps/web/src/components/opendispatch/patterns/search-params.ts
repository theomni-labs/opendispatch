// SPDX-License-Identifier: AGPL-3.0-only
// The server half of state in the URL. A screen reads its `searchParams` through
// `parseSearchParams`, which keeps only the parameters the screen declares, each checked against its allow-list, and gives
// `undefined` for anything absent, unknown, malformed or out of range. Nothing in the address bar is trusted:
//
//   const Q = { tab: param.enum(['users', 'roles']), q: param.text(80), role: param.enum(ROLES), page: param.int(1, 500),
//               id: param.id(), new: param.flag(), sort: param.sort(['name', 'role']) };
//   const query = parseSearchParams(searchParams, Q);      // { tab?: 'users' | 'roles', q?: string,... }
//
// A parameter's value is only ever a FILTER or a view choice. It is never the caller's identity: a schema may not declare
// a key that names a customer, tenant, user, context, zone scope or install mode (`parseSearchParams` throws, so the
// mistake shows in the first test, not in production). A list filter called `role` (the users list "Role" chip) is allowed:
// it filters the rows by their assigned role and is checked against the enum; the caller's own role always comes from the
// session. Pure: no React and no Next.

export type SearchParamsInput = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface SortParam {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

export type ParamSpec =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'text'; readonly max: number }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'flag' }
  | { readonly kind: 'id' }
  | { readonly kind: 'pattern'; readonly regex: RegExp; readonly max: number }
  | { readonly kind: 'sort'; readonly columns: readonly string[] };

export type ParamSchema = Readonly<Record<string, ParamSpec>>;

type ValueOf<P extends ParamSpec> = P extends { kind: 'enum'; values: infer V extends readonly string[] }
  ? V[number]
  : P extends { kind: 'int' }
    ? number
    : P extends { kind: 'flag' }
      ? true
      : P extends { kind: 'sort' }
        ? SortParam
        : string;

/** The parsed parameters: every key optional, present only when the value passed its check. */
export type ParsedParams<S extends ParamSchema> = { readonly [K in keyof S]?: ValueOf<S[K]> };

/** Constructors for the specs, so a schema reads as one line per parameter and the enum keeps its literal type. */
export const param = {
  enum: <const V extends readonly string[]>(values: V) => ({ kind: 'enum', values }) as const satisfies ParamSpec,
  /** Free text (a search box): control characters removed, trimmed, cut to `max`; empty is absent. */
  text: (max = 120) => ({ kind: 'text', max }) as const satisfies ParamSpec,
  /** A whole number from `min` to `max` (a page). */
  int: (min: number, max: number) => ({ kind: 'int', min, max }) as const satisfies ParamSpec,
  /** `1` or `true` gives `true` (a drawer that is open: `new=1`). */
  flag: () => ({ kind: 'flag' }) as const satisfies ParamSpec,
  /** A UUID (a record id). Whether the record exists is the screen's business: an unknown id shows a notice, never a 500. */
  id: () => ({ kind: 'id' }) as const satisfies ParamSpec,
  /** A string that matches `regex` and is at most `max` long (a rule code such as RULE-012). */
  pattern: (regex: RegExp, max = 64) => ({ kind: 'pattern', regex, max }) as const satisfies ParamSpec,
  /** `column:asc` or `column:desc`, the column one of `columns`. */
  sort: <const C extends readonly string[]>(columns: C) => ({ kind: 'sort', columns }) as const satisfies ParamSpec,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The text without C0 control characters and DEL (a newline or a NUL in a query string is never search text). */
const withoutControls = (text: string): string =>
  Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('');

/** Parameter names that would let the address bar say who is asking. Compared lower-cased, without `_` and `-`. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['customer', 'customerid', 'tenant', 'tenantid', 'installmode', 'ctx', 'context', 'userid', 'user', 'zonescope']);

const normaliseName = (name: string): string => name.toLowerCase().replaceAll(/[_-]/g, '');

const firstOf = (value: string | readonly string[] | undefined): string | undefined => (typeof value === 'string' ? value : value?.[0]);

function parseOne(spec: ParamSpec, raw: string): unknown {
  switch (spec.kind) {
    case 'enum':
      return spec.values.includes(raw) ? raw : undefined;
    case 'text': {
      const text = withoutControls(raw).trim().slice(0, spec.max);
      return text === '' ? undefined : text;
    }
    case 'int': {
      if (!/^\d{1,9}$/.test(raw)) return undefined;
      const n = Number(raw);
      return n >= spec.min && n <= spec.max ? n : undefined;
    }
    case 'flag':
      return raw === '1' || raw === 'true' ? true : undefined;
    case 'id':
      return UUID.test(raw) ? raw : undefined;
    case 'pattern':
      return raw.length <= spec.max && spec.regex.test(raw) ? raw : undefined;
    case 'sort': {
      const [key, direction, ...rest] = raw.split(':');
      if (key === undefined || rest.length > 0 || !spec.columns.includes(key) || (direction !== 'asc' && direction !== 'desc')) return undefined;
      return { key, direction } satisfies SortParam;
    }
  }
}

/**
 * The parameters of `schema` found in `searchParams`, each validated; everything else is ignored. A repeated parameter
 * (`?q=a&q=b`) counts once, as the first value. Throws only for a schema that declares an identity key.
 */
export function parseSearchParams<S extends ParamSchema>(searchParams: SearchParamsInput, schema: S): ParsedParams<S> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    if (IDENTITY_KEYS.has(normaliseName(key))) {
      throw new Error(`Search parameter "${key}" names a customer, user, context, zone scope or install mode: the address bar never says who is asking.`);
    }
    // Own keys only: a query named `constructor` or `__proto__` reads nothing from the prototype chain.
    const raw = Object.hasOwn(searchParams, key) ? firstOf(searchParams[key]) : undefined;
    if (raw === undefined) continue;
    const value = parseOne(spec, raw);
    if (value !== undefined) out[key] = value;
  }
  return out as ParsedParams<S>;
}
