# Messages

All user-facing text of the web app, in English and Arabic, loaded with next-intl. Arabic pages render right to left.

## Files

| Path | Holds |
|---|---|
| `en.json`, `ar.json` | Core strings: the Ops and Admin shells, shared states, design-system labels (`ds`), shared OpenDispatch components (`opendispatch`), shared words (`common`), shared blocks (`patterns`) |
| `admin/<module>/{en,ar}.json` | One Admin screen's text; 18 folders named by the module id without `admin.` (for example `users_roles`) |
| `ops/<module>/{en,ar}.json` | One Ops screen's text; 12 folders (for example `live_dispatch_board`) |
| `ar.status.json` | Review status of every Arabic key: `draft` or `reviewed` |

A module file has no prefix: the loader places it under `admin.<module>` or `ops.<module>`, so a screen reads
`useTranslations('admin.users_roles')`. A module may define its own `states.empty.*` and `states.error.*` lines;
without them the core `states.*` lines show. The browser gets the core file plus the one module of the route, never
another module's file. `admin` and `ops` are reserved: core has no top-level key of either name.

Navigation keys: `nav.<console>.<module>.title` is the full module title, `.menu` the one to three word menu label,
`nav.<console>.group.<group>` the menu group.

## Rules

- **Same keys in both languages,** for core and for each module. A test checks it.
- **Translator names.** Write `m = useTranslations('admin.<module>')` for a module's keys and `t = useTranslations()`
  for core keys (`t('common.save')`, `t('roles.planner')`). A static scan
  (`apps/web/src/screens/<console>/<module>/messages-usage.test.ts`) reads these names and catches a core key asked
  of the module translator: next-intl reports a missing key only when the text is drawn, so a path no test opens
  would otherwise ship broken.
- **Shared text is not repeated.** `common.*` holds shared words (Cancel, Save, Close, Back, Next, Export, Status,
  Zone, Reason, ...). `patterns.*` holds the text of the shared blocks in `apps/web/src/components/opendispatch/patterns/`
  and the action layer, including `patterns.action.error.<code>` for `unauthenticated`, `forbidden`, `not_found`,
  `invalid`, `conflict`, `unexpected` and the client-only `network`.
- **Plurals** are ICU plurals. Arabic phrases with a count use all six forms (zero, one, two, few, many, other). Use
  `{n}` inside a plural branch, never `#`: `#` prints Arabic-Indic digits in Arabic, and the app writes Western digits
  in both languages.
- **Names from data.** Zone and city names come from the data. The synthetic data has English names only, so they
  appear in English on Arabic pages.

## Arabic terms

The Arabic is Modern Standard Arabic. The terms used throughout:

- Agent: مندوب (مندوبان، مندوبون/مندوبين). Case: بلاغ / بلاغات (حالة only for a status or state).
- Dispatch: التوجيه (مشرف التوجيه، منسّق التوجيه، لوحة التوجيه المباشر). Assignment: الإسناد.
- Fallback: الإسناد الاحتياطي (the mechanism), الرجوع إلى توجيه العميل (the event).
- Gap and surplus: العجز والفائض. Standby point: نقطة تمركز. Override: تعديل يدوي. Forecast: توقع.
- Demo: عرض تجريبي. Stub: (محاكاة). Placeholder: مؤقت. Dry run: تشغيل تجريبي.

## Review status

**The Arabic has not been reviewed by a native reader yet.** Every key in `ar.status.json` is `draft`. A test
(`scripts/i18n/status.test.ts`) fails when an Arabic key has no status, or a status has no key; add new Arabic keys to
`ar.status.json` as `draft`.

To review, print the drafts as CSV:

```sh
pnpm i18n:review-sheet                          # all drafts
pnpm i18n:review-sheet --module users_roles  # one module
pnpm i18n:review-sheet --count               # counts only
pnpm i18n:review-sheet --out drafts.csv
```

Put the reviewer's corrections in the JSON files and set those keys to `reviewed` in `ar.status.json`. Contributions
from native readers are welcome.
