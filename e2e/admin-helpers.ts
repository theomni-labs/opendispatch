// SPDX-License-Identifier: AGPL-3.0-only
// Shared code of the cross-cutting Admin specs: admin-matrix, admin-states, admin-structure and
// admin-screenshots. Nothing here decides what a role may see: the expectations are computed from the access module (the
// same import routes.ts uses), so a change to the model changes the specs' expectations and never leaves a second table to
// drift. What is written down here is facts about the SCREENS that the model cannot know (which module's URL takes which
// `?id=`, which text an empty state shows), each read from the source or the message files where it can be.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import {
  ADMIN_MODULE_IDS,
  INSTALL_MODES,
  canSeeConsole,
  getModule,
  moduleAccess,
  rolesForInstallMode,
  scopeAppliesTo,
  type InstallMode,
  type ModuleAccessResult,
  type ModuleDef,
  type Role,
} from '../apps/web/src/lib/access';
import { expectFontsLoaded, waitForHydration } from './helpers';
import { landingOf, pathOf, text, titleOf, type Locale } from './routes';
import { readMessages } from './messages';

const ROOT = path.resolve(import.meta.dirname, '..');

// --- the access model, as the specs use it -------------------------------------------------------------------------------

export const ADMIN_MODULES: readonly ModuleDef[] = ADMIN_MODULE_IDS.map((id) => getModule(id));
export const MODES: readonly InstallMode[] = INSTALL_MODES;
/** The roles the demo offers in an install mode: seven in private, six otherwise (Change Approver is private only). */
export const rolesIn = (mode: InstallMode): readonly Role[] => rolesForInstallMode(mode);
export const cellOf = (role: Role, def: ModuleDef, mode: InstallMode): ModuleAccessResult => moduleAccess(role, def.id, mode);
/** False for a role with no Admin module at all: the console layout then shows one page-level no-access panel, with no module frame. */
export const hasAdminConsole = (role: Role, mode: InstallMode): boolean => canSeeConsole(role, 'admin', mode);
// The same, for the console of def.
export const hasConsoleOf = (role: Role, def: ModuleDef, mode: InstallMode): boolean => canSeeConsole(role, def.console, mode);
export const zoneScopedRoles = (mode: InstallMode): readonly Role[] => rolesIn(mode).filter((role) => scopeAppliesTo(role) === 'assigned_zones');
export const slugOf = (def: ModuleDef): string => pathOf(def).split('/')[2] ?? '';
export const adminUrl = (locale: Locale, def: ModuleDef, query = ''): string => `/${locale}${pathOf(def)}${query}`;
export const frameOf = (page: Page, def: ModuleDef) => page.locator(`main [data-module="${def.id}"]`);

// --- messages: the module's own files, read the way the module specs read them ------------------------------------------

type Tree = { [key: string]: string | Tree };
const trees = new Map<string, Tree>();
function dig(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  return typeof node === 'string' ? node : undefined;
}
const moduleTree = (locale: Locale, def: ModuleDef): Tree => {
  const file = path.join(ROOT, 'apps/web/messages', def.console, def.id.slice(def.console.length + 1), `${locale}.json`);
  if (!trees.has(file)) trees.set(file, readMessages(file) as Tree);
  return trees.get(file) as Tree;
};
/** A key of the module's own message file (`notice.notFound`); throws when it is missing, so a renamed key fails the spec loudly. */
export function moduleText(locale: Locale, def: ModuleDef, key: string): string {
  const found = dig(moduleTree(locale, def), key);
  if (found === undefined) throw new Error(`No message ${def.id}.${locale}:${key}`);
  return found;
}
const coreTextOr = (locale: Locale, key: string): string | undefined => {
  try {
    return text(locale, key);
  } catch {
    return undefined;
  }
};
/** The line a state shows (`states.empty.title`): the module's own text, else the core one, as the frame does (screen-text.ts). */
export const stateLine = (locale: Locale, def: ModuleDef, state: 'empty' | 'error', part: 'title' | 'desc'): string | undefined =>
  dig(moduleTree(locale, def), `states.${state}.${part}`) ?? coreTextOr(locale, `states.${state}.${part}`);

// --- facts about the screens that are read from the source, so they cannot drift ----------------------------------------

/** The skeleton shape of a module (`list`, `cards`, `form`, `detail`), read from the table in ScreenSkeleton.tsx. */
export function skeletonShape(def: ModuleDef): string {
  const source = fs.readFileSync(path.join(ROOT, 'apps/web/src/components/opendispatch/ScreenSkeleton.tsx'), 'utf8');
  const match = new RegExp(`'${def.id}':\\s*'(list|cards|form|detail)'`).exec(source);
  if (match?.[1] !== undefined) return match[1];
  // Ops: skeletonShapeOf's default.
  if (def.console === 'ops') return 'detail';
  throw new Error(`ScreenSkeleton.tsx has no shape for ${def.id}`);
}
/** True when the module's screen passes an `emptyAction` to the frame (Audit Log and Forecast have none: nothing to add or run). */
export const hasEmptyAction = (def: ModuleDef): boolean =>
  fs.readFileSync(path.join(ROOT, 'apps/web/src/screens/admin', def.id.slice('admin.'.length), 'Screen.tsx'), 'utf8').includes('emptyAction=');

/** The modules whose URL names a record, and what the server does with a value that names none. */
export interface DeepLink {
  param: string;
  /** Set when the parameter only means something on one tab. */
  tab?: string;
  /** Message key of the module's inline notice. */
  notice: string;
  /** A value the server ignores as malformed (the URL check) or reports as unknown (the record check). */
  malformed: string;
  /** True when the malformed value still reaches the record check, so the notice shows for it too. */
  malformedShowsNotice: boolean;
  /** A well-formed value that names no record. */
  unknown: string;
}
const NONE = '00000000-0000-4000-8000-000000000000';
const link = (param: string, notice: string, extra: Partial<DeepLink> = {}): DeepLink => ({ param, notice, malformed: 'not-a-uuid', malformedShowsNotice: false, unknown: NONE, ...extra });
export const DEEP_LINKS: Readonly<Record<string, readonly DeepLink[]>> = {
  'admin.users_roles': [link('id', 'notice.notFound', { malformedShowsNotice: true })],
  'admin.sign_in_identity': [
    link('provider', 'notice.provider', { tab: 'providers', malformedShowsNotice: true }),
    link('rule', 'notice.rule', { tab: 'rules' }),
  ],
  'admin.locations': [link('edit', 'notice.notFound', { malformed: 'zone:not-a-uuid', unknown: `zone:${NONE}` })],
  'admin.agents_vehicles': [link('agent', 'notice.notFound', { tab: 'agents' }), link('vehicle', 'notice.notFound', { tab: 'vehicles' })],
  'admin.classification_rules': [link('rule', 'notice.notFound', { unknown: 'RULE-999' })],
  'admin.shift_break_policies': [link('pattern', 'notice.notFound')],
  'admin.leave_policy_calendar': [link('holiday', 'notice.notFound', { tab: 'holidays' })],
  'admin.data_import_quality': [
    link('job', 'notice.jobNotFound', { tab: 'jobs', malformedShowsNotice: true }),
    link('issue', 'notice.issueNotFound', { tab: 'issues', malformedShowsNotice: true }),
  ],
  'admin.audit_log': [link('id', 'notice.notFound', { malformedShowsNotice: true })],
  'admin.notifications_alerts': [link('rule', 'notice.ruleNotFound', { tab: 'rules', malformedShowsNotice: true })],
  'admin.api_webhooks': [link('hook', 'notice.hook', { tab: 'hooks' })],
  'admin.security_compliance': [link('control', 'notice.control', { tab: 'controls' })],
};

// --- watching a page: stricter than watch() in helpers.ts (warnings count too) ------------------------------------------

// Browser hints that are not the page's fault: a <link rel=preload> the page did not use within a few seconds.
const BENIGN_WARNINGS: readonly RegExp[] = [
  /was preloaded using link preload but not used/,
  // Headless GPU note from the map's WebGL.
  /GL Driver Message \(OpenGL, Performance/,
];

/** Requests to another origin, script errors, and console errors AND warnings. Call `expectClean()` at the end of a test. */
export function watchStrict(page: Page, baseURL: string | undefined) {
  const external: string[] = [];
  const problems: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL ?? '') && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const line = message.text();
    const where = message.location().url;
    if (line.includes('favicon') || where.includes('favicon')) return;
    if (type === 'warning' && BENIGN_WARNINGS.some((pattern) => pattern.test(line))) return;
    problems.push(`${type}: ${line}${where === '' ? '' : ` (${where})`}`);
  });
  return {
    expectClean() {
      expect(external, 'requests that left the app (fonts and assets must be bundled)').toEqual([]);
      expect(problems, 'script errors, console errors and console warnings').toEqual([]);
    },
  };
}

// --- signing in and switching, the way a person does --------------------------------------------------------------------

/**
 * startDemo with a zone choice: the start page preselects the first two zones, so this clears them and ticks the one named
 * (its English name: the demo lists zones by `name_en` in both languages).
 */
export async function startDemoInZone(page: Page, locale: Locale, role: Role, installMode: InstallMode, zoneName: string) {
  await page.goto(`/${locale}`);
  await waitForHydration(page, 'form');
  await page.locator(`input[type=radio][value="${installMode}"]`).check();
  await page.locator(`input[type=radio][value="${role}"]`).check();
  for (const box of await page.locator('form input[type=checkbox]').all()) if (await box.isChecked()) await box.uncheck();
  await page.getByRole('checkbox', { name: zoneName, exact: true }).check();
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(new RegExp(`/${locale}/(ops|admin)/`));
  await waitForHydration(page, '[data-shell="topbar"] button');
}

/** Switches the role of a signed-in session through the Demo pop-over (the cookie is replaced for the whole browser context). */
export async function switchRole(page: Page, role: Role, landing: string) {
  await waitForHydration(page, '[data-shell="topbar"] button');
  await page.locator('[data-demo-switcher="trigger"]').click();
  const panel = page.locator('[data-demo-switcher="panel"]');
  await panel.locator(`input[type=radio][value="${role}"]`).check();
  await panel.locator('button[type=submit]').click();
  await page.waitForURL(new RegExp(`${landing}$`));
}

// --- what one module page says about itself (matrix) ---------------------------------------------------------------------

export interface PageFacts {
  lang: string;
  dir: string;
  overflow: number;
  h1: string[];
  root: { id: string; state: string; access: string; reduced: string } | null;
  header: { text: string; controls: Array<{ name: string; disabled: boolean; popup: boolean; gated: boolean }> } | null;
  content: { tabs: number; tables: number; busy: number; h2: string[]; textLength: number };
  main: { text: string; goHomeHref: string | null };
}

/** One round trip: the hooks of the frame, the header's controls and what the page holds. `goHome` is the label of the no-access link. */
export async function readFacts(page: Page, goHome: string): Promise<PageFacts> {
  return page.evaluate((goHomeLabel) => {
    const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true });
    const rootEl = document.querySelector('[data-module]');
    const header = rootEl?.querySelector(':scope > header') ?? null;
    const controls = [...(header?.querySelectorAll('button, a[href]') ?? [])]
      .filter((el) => el.getAttribute('role') !== 'tab')
      .map((el) => ({
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        popup: el.getAttribute('aria-haspopup') !== null,
        gated: el.closest('[data-gated]') !== null,
      }));
    const main = document.querySelector('main') as HTMLElement | null;
    const link = [...(main?.querySelectorAll('a[href]') ?? [])].find((a) => (a.textContent ?? '').trim() === goHomeLabel);
    const rootText = (rootEl as HTMLElement | null)?.innerText ?? '';
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      h1: [...document.querySelectorAll('h1')].filter(visible).map((h) => (h.textContent ?? '').trim()),
      root: rootEl === null ? null : { id: rootEl.getAttribute('data-module') ?? '', state: rootEl.getAttribute('data-state') ?? '', access: rootEl.getAttribute('data-access') ?? '', reduced: rootEl.getAttribute('data-reduced') ?? '' },
      header: header === null ? null : { text: (header as HTMLElement).innerText, controls },
      content: {
        tabs: rootEl?.querySelectorAll('[role="tab"]').length ?? 0,
        tables: rootEl?.querySelectorAll('table').length ?? 0,
        busy: rootEl?.querySelectorAll('[aria-busy="true"]').length ?? 0,
        h2: [...(rootEl?.querySelectorAll('h2') ?? [])].filter(visible).map((h) => (h.textContent ?? '').trim()),
        textLength: rootText.length - ((header as HTMLElement | null)?.innerText.length ?? 0),
      },
      main: { text: main?.innerText ?? '', goHomeHref: link?.getAttribute('href') ?? null },
    };
  }, goHome);
}

export interface Outcome {
  mode: InstallMode;
  role: Role;
  def: ModuleDef;
  locale: Locale;
}

/**
 * What the access model says one (install mode, role, module) cell must look like, checked against what the page shows. Soft
 * assertions, so one run lists every wrong cell of a role. Not proved here: that a view-only page has no enabled write control
 * in its body (only the header is checked; the rest is per module, in the module specs).
 */
export function expectOutcome(facts: PageFacts, { mode, role, def, locale }: Outcome) {
  const who = `${mode} / ${role} / ${def.id} / ${locale}`;
  const cell = cellOf(role, def, mode);
  const noAccess = text(locale, 'states.noAccess.title');
  const title = titleOf(locale, def.id);
  expect.soft(facts.lang, `${who}: <html lang>`).toBe(locale);
  expect.soft(facts.dir, `${who}: <html dir>`).toBe(locale === 'ar' ? 'rtl' : 'ltr');
  expect.soft(facts.overflow, `${who}: horizontal overflow in px`).toBeLessThanOrEqual(0);

  if (cell.access === 'none') {
    if (hasConsoleOf(role, def, mode)) {
      expect.soft(facts.root, `${who}: the hooks of a no-access module page`).toEqual({ id: def.id, state: 'noaccess', access: 'none', reduced: 'false' });
      expect.soft(facts.h1, `${who}: the one h1 is the module title`).toEqual([title]);
    } else {
      // No console: the layout's panel, no frame.
      expect.soft(facts.root, `${who}: no module frame for a role with no Admin Console`).toBeNull();
      expect.soft(facts.h1, `${who}: the one h1 is the no-access title`).toEqual([noAccess]);
    }
    expect.soft(facts.main.text, `${who}: the no-access panel`).toContain(noAccess);
    expect.soft(facts.header?.controls ?? [], `${who}: no header control without access`).toEqual([]);
    expect.soft([facts.content.tabs, facts.content.tables, facts.content.busy], `${who}: no tabs, table or skeleton without access`).toEqual([0, 0, 0]);
    const home = landingOf(role, mode) ?? '';
    expect.soft(facts.main.goHomeHref?.endsWith(home), `${who}: Go home leads to the landing page ${home} (href ${facts.main.goHomeHref})`).toBe(true);
    return;
  }

  expect.soft(facts.root, `${who}: the hooks of the frame`).toEqual({ id: def.id, state: 'filled', access: cell.access, reduced: String(cell.reduced) });
  expect.soft(facts.h1, `${who}: the one h1 is the module title`).toEqual([title]);
  const header = facts.header?.text ?? '';
  const badge = (key: 'view' | 'reduced') => header.includes(text(locale, `shell.access.${key}`));
  expect.soft(badge('view'), `${who}: the "View only" badge is there exactly for view access`).toBe(cell.access === 'view');
  expect.soft(badge('reduced'), `${who}: the "Reduced" badge is there exactly for the reduced screen`).toBe(cell.reduced);
  const controls = facts.header?.controls ?? [];

  if (cell.reduced) {
    // The Administrator of a dedicated or shared install: the version and the release notes, and nothing that acts.
    expect.soft(facts.content.h2, `${who}: the reduced screen holds release notes and version only`).toEqual([moduleText(locale, def, 'rn.title'), moduleText(locale, def, 'rv.title')]);
    expect.soft(controls, `${who}: no control on the reduced screen`).toEqual([]);
    expect.soft([facts.content.tabs, facts.content.tables], `${who}: no tabs or table on the reduced screen`).toEqual([0, 0]);
    return;
  }
  expect.soft(facts.content.textLength, `${who}: content is present`).toBeGreaterThan(40);
  expect.soft(facts.content.busy, `${who}: no skeleton left`).toBe(0);
  if (def.id === 'admin.updates') expect.soft(facts.content.tabs, `${who}: the full Updates screen has five tabs`).toBe(5);
  if (def.console === 'ops') {
    expectOpsHeader(controls, cell.access, locale, who);
    return;
  }
  if (cell.access === 'edit') {
    expect.soft(controls.some((control) => !control.disabled), `${who}: an enabled action in the header`).toBe(true);
  } else if (def.id !== 'admin.audit_log') {
    // View only: every header action that is not a menu is disabled, and at least one says why (the gate wraps it). The Audit Log
    // is view-only for everyone by design (append only): its Export reads, so it is exempt.
    expect.soft(controls.filter((control) => !control.popup && !control.disabled), `${who}: enabled write action in a view-only header`).toEqual([]);
    expect.soft(controls.some((control) => control.gated), `${who}: a disabled header action with its reason`).toBe(true);
  }
}

// Ops header: Export and menus stay enabled.
function expectOpsHeader(controls: NonNullable<PageFacts['header']>['controls'], access: 'view' | 'edit', locale: Locale, who: string) {
  expect.soft(controls.length, `${who}: the header has an action`).toBeGreaterThan(0);
  if (access === 'edit') {
    expect.soft(controls.filter((control) => control.disabled), `${who}: a disabled header control with edit access`).toEqual([]);
    return;
  }
  const writes = controls.filter((control) => !control.popup && control.name !== text(locale, 'common.export'));
  expect.soft(writes.filter((control) => !control.disabled), `${who}: enabled write action in a view-only header`).toEqual([]);
  expect.soft(writes.filter((control) => !control.gated), `${who}: a disabled header action without its reason`).toEqual([]);
}

// --- structure scans (admin-structure) -----------------------------------------------------------------------------------

/**
 * Tokens that stay Latin in an Arabic page. The product name, the language name, format and protocol names, regulation
 * codes, identity products and unit symbols: things with no Arabic form. Names, codes and e-mail addresses of records are
 * NOT here: they are marked translate="no" and the scan skips that subtree. An entry needs its reason.
 */
export const LATIN_ALLOWED: readonly string[] = [
  'OPENDISPATCH', // the product name (shell.brand)
  'EN', // the language toggle shows the two codes as they are
  'AR', // the language toggle
  'English', // the language name in its own language (language.en)
  'https', // the scheme in a URL hint
  'JSON', // a file format
  'CSV', // a file format
  'PDF', // a file format
  'DOCX', // a file format
  'PNG', // a file format
  'SAML', // a protocol name
  'OIDC', // a protocol name
  'NCA', // a regulation code (Saudi National Cybersecurity Authority controls)
  'PDPL', // a regulation code (Personal Data Protection Law)
  'ADFS', // an identity product
  'Okta', // an identity product
  'Entra', // an identity product (Microsoft Entra ID)
  'ID', // "Entra ID" and "Object ID"
  'Keycloak', // an identity product
  'Workspace', // an identity product (Google Workspace)
  'Cloud', // an identity product (Google Cloud Identity)
  'Identity', // an identity product (Google Cloud Identity)
  'UTC', // a time zone code
  'GMT', // a time zone code
  'km', // a unit symbol
  'ms', // a unit symbol
  'KB', // a unit symbol
  'MB', // a unit symbol
  'GB', // a unit symbol
];

export interface TextScan {
  latin: string[];
  digits: string[];
}

/**
 * Walks every rendered text node and every accessible-name attribute (aria-label, placeholder, title, alt, and the document
 * title) outside `translate="no"` subtrees. `latin`: English words (only on request: the Arabic page; `lang="en"` subtrees are
 * skipped too). `digits`: Arabic-Indic digits U+0660-0669 and U+06F0-06F9, except inside
 * `digitsSkip` (the Localization page's `[data-preview]` sample, which shows Arabic-Indic digits on purpose).
 */
export async function scanText(page: Page, options: { latin: boolean; digitsSkip: string }): Promise<TextScan> {
  return page.evaluate(
    ({ allowed, latin, digitsSkip }) => {
      const SKIP = '[translate="no"], script, style, noscript, template';
      const LATIN = /[A-Za-z][A-Za-z'’-]+/g;
      const INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;
      const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true });
      const where = (el: Element) => {
        const chain: string[] = [];
        for (let node: Element | null = el; node !== null && chain.length < 4; node = node.parentElement) chain.unshift(`${node.tagName.toLowerCase()}${node.getAttribute('role') === null ? '' : `[${node.getAttribute('role')}]`}`);
        return chain.join(' > ');
      };
      const out: { latin: string[]; digits: string[] } = { latin: [], digits: [] };
      const check = (value: string, el: Element, kind: string) => {
        const at = `${kind} in ${where(el)}: "${value.trim().slice(0, 70)}"`;
        if (INDIC.test(value) && (digitsSkip === '' || el.closest(digitsSkip) === null)) out.digits.push(at);
        if (!latin || el.closest('[lang="en"]') !== null) return;
        for (const word of value.match(LATIN) ?? []) if (!allowed.includes(word)) out.latin.push(`${word} (${at})`);
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const el = node.parentElement;
        if (el !== null && el.closest(SKIP) === null && visible(el)) check(node.textContent ?? '', el, 'text');
      }
      for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
        if (el.closest(SKIP) !== null || !visible(el)) continue;
        for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
          const value = el.getAttribute(attr);
          if (value !== null && value !== '') check(value, el, attr);
        }
      }
      check(document.title, document.documentElement, 'document.title');
      return out;
    },
    { allowed: [...LATIN_ALLOWED], latin: options.latin, digitsSkip: options.digitsSkip },
  );
}

const NAMED_ROLES = 'button|link|textbox|combobox|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|searchbox|spinbutton|slider';
/**
 * Buttons, links and inputs that have no accessible name, read from the browser's own accessibility tree (an ARIA snapshot):
 * a control shows as `button "Save"` when it has a name and as a bare `button` when it has none. Hidden elements are not in it.
 */
export async function unnamedControls(page: Page): Promise<string[]> {
  const lines = (await page.locator('body').ariaSnapshot()).split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    const match = new RegExp(`^(\\s*)- (${NAMED_ROLES})\\b(.*)$`).exec(line);
    if (match === null || /^ "(?!")/.test(match[3] ?? '')) return;
    const indent = (match[1] ?? '').length;
    const parent = lines.slice(0, index).reverse().find((above) => above.search(/\S/) < indent && above.trim() !== '');
    found.push(`${line.trim()}  (inside ${parent?.trim() ?? 'the document'})`);
  });
  return found;
}

/** Icon-only buttons and links (an icon and no text, not even a screen-reader-only one) with no `aria-label`. */
export async function iconOnlyWithoutLabel(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true });
    const textOf = (el: Element) => {
      const clone = el.cloneNode(true) as Element;
      for (const node of clone.querySelectorAll('svg, [aria-hidden="true"]')) node.remove();
      return (clone.textContent ?? '').trim();
    };
    return [...document.querySelectorAll('button, a[href], [role="button"]')]
      .filter((el) => visible(el) && el.querySelector('svg') !== null && textOf(el) === '' && (el.getAttribute('aria-label') ?? '').trim() === '' && el.getAttribute('aria-labelledby') === null)
      .map((el) => `${el.tagName.toLowerCase()} ${(el.getAttribute('class') ?? '').split(' ')[0] ?? ''} in ${el.parentElement?.tagName.toLowerCase() ?? '?'}`);
  });
}

/**
 * The first three tab stops of a fresh page must show focus (an outline or a ring, read from the computed style of the focused
 * element), and, from the page's <main> (where the skip link leaves a keyboard user), Tab must reach the first enabled control of
 * the page header, the module's primary action, within 40 presses. Focus rings drawn on a sibling of a hidden input are not seen
 * by this check (the first three stops are shell links and buttons, which draw their own).
 */
export async function keyboardProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  for (let stop = 1; stop <= 3; stop++) {
    await page.keyboard.press('Tab');
    const seen = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || el === document.body) return null;
      const style = getComputedStyle(el);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      return { label: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`, focusVisible: el.matches(':focus-visible'), ring: outline || style.boxShadow !== 'none' };
    });
    if (seen === null) problems.push(`tab stop ${stop}: focus is on nothing`);
    else if (!seen.focusVisible || !seen.ring) problems.push(`tab stop ${stop}: no visible focus on ${seen.label} (:focus-visible ${seen.focusVisible}, outline or ring ${seen.ring})`);
  }
  const marked = await page.evaluate(() => {
    const header = document.querySelector('[data-module] > header');
    const first = [...(header?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])].find((el) => el.getAttribute('role') !== 'tab' && el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled'));
    first?.setAttribute('data-e2e-primary', '1');
    return first !== undefined;
  });
  if (!marked) return [...problems, 'the page header has no enabled control to reach'];
  await page.locator('main').focus();
  for (let press = 0; press < 40; press++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.hasAttribute('data-e2e-primary') === true)) return problems;
  }
  return [...problems, 'Tab from <main> did not reach the first enabled control of the page header within 40 presses'];
}

/**
 * Everything the structure spec asserts about one rendered module page, as a list of problems (empty when it is right). Each
 * check runs on its own, so one failure does not hide the next. `fonts` is checked once per test, not per width.
 */
export async function structureProblems(page: Page, def: ModuleDef, locale: Locale, width: number, fonts: boolean): Promise<string[]> {
  const problems: string[] = [];
  const check = async (name: string, run: () => Promise<string[]>) => {
    try {
      for (const problem of await run()) problems.push(`${name}: ${problem}`);
    } catch (error) {
      problems.push(`${name}: could not run: ${(error as Error).message.split('\n')[0]}`);
    }
  };
  await check('html', async () => {
    const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.getAttribute('data-theme'), overflow: document.documentElement.scrollWidth - window.innerWidth }));
    return [
      ...(html.lang === locale ? [] : [`lang is "${html.lang}"`]),
      ...(html.dir === (locale === 'ar' ? 'rtl' : 'ltr') ? [] : [`dir is "${html.dir}"`]),
      ...(html.theme === 'light' ? [] : [`data-theme is "${html.theme}", OpenDispatch is light only`]),
      ...(html.overflow <= 0 ? [] : [`the page scrolls sideways by ${html.overflow}px`]),
    ];
  });
  await check('landmarks', async () => {
    const [main, banner, navigation, navInDom, h1] = await Promise.all([
      page.getByRole('main').count(),
      page.getByRole('banner').count(),
      page.getByRole('navigation').count(),
      page.locator('nav').count(),
      page.getByRole('heading', { level: 1 }).count(),
    ]);
    // Below 1024px the rail is a drawer: its <nav> is in the page but hidden, so only the menu button is visible.
    const menuButton = width < 1024 ? await page.getByRole('button', { name: text(locale, 'ds.railShell.menuOpen') }).count() : 1;
    return [
      ...(main === 1 ? [] : [`${main} main landmarks`]),
      ...(banner === 1 ? [] : [`${banner} banner landmarks`]),
      ...(width >= 1024 ? (navigation >= 1 ? [] : ['no navigation landmark']) : navInDom >= 1 && menuButton === 1 ? [] : [`the drawer navigation is missing (${navInDom} nav, ${menuButton} menu buttons)`]),
      ...(h1 === 1 ? [] : [`${h1} h1 headings`]),
    ];
  });
  if (fonts) {
    await check('fonts', async () => {
      try {
        await expectFontsLoaded(page, locale);
        return [];
      } catch (error) {
        return [(error as Error).message.split('\n').slice(0, 3).join(' ')];
      }
    });
  }
  await check('text', async () => {
    const scan = await scanText(page, { latin: locale === 'ar', digitsSkip: def.id === 'admin.localization' ? '[data-preview]' : '' });
    return [...scan.digits.map((entry) => `Arabic-Indic digit, ${entry}`), ...scan.latin.map((entry) => `English word ${entry}`)];
  });
  await check('names', async () => (await unnamedControls(page)).map((entry) => `no accessible name: ${entry}`));
  await check('icons', async () => (await iconOnlyWithoutLabel(page)).map((entry) => `icon-only control without aria-label: ${entry}`));
  await check('keyboard', () => keyboardProblems(page));
  return problems.map((problem) => `[${locale} ${width}px ${def.id}] ${problem}`);
}

/** Waits until React owns the top bar, as startDemo does, so keyboard and click checks meet live handlers. */
export const hydrated = (page: Page) => waitForHydration(page, '[data-shell="topbar"] button');

/**
 * Waits for the page's real content to have replaced the route's loading.tsx skeleton (which has no h1 at all, module or
 * console level) before a synchronous read of the page (readFacts, structureProblems) takes its snapshot. Every settled
 * state — filled, a module's own no-access panel, or the console-level one for a role with no Admin Console — has exactly
 * one h1, so this is the one condition common to all of them.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  // The route's loading skeleton has an h1 too.
  await expect(page.locator('[data-skeleton], [data-state="loading"]')).toHaveCount(0, { timeout: 15_000 });
}
