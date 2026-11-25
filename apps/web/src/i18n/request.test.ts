// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { loadServerMessages } from './messages';

// `getRequestConfig` returns the function it is given (next-intl); outside Server Components the package's own stand-in
// throws, so the real one is replaced by the same identity to call the config.
vi.mock('next-intl/server', () => ({ getRequestConfig: (config: unknown) => config }));

type RequestConfig = (args: { requestLocale: Promise<string | undefined> }) => Promise<{ locale: string; messages: unknown }>;

async function requestConfig(): Promise<RequestConfig> {
  return (await import('./request')).default as unknown as RequestConfig;
}

describe('request config', () => {
  it('gives the server core plus every module, in the language asked for', async () => {
    const config = await requestConfig();
    const ar = await config({ requestLocale: Promise.resolve('ar') });
    expect(ar.locale).toBe('ar');
    expect(ar.messages).toEqual(loadServerMessages('ar'));
    const en = await config({ requestLocale: Promise.resolve('en') });
    expect(en.locale).toBe('en');
    expect(en.messages).toEqual(loadServerMessages('en'));
  });

  it('serves the default language for an unknown or missing one', async () => {
    const config = await requestConfig();
    expect((await config({ requestLocale: Promise.resolve('fr') })).locale).toBe('en');
    expect((await config({ requestLocale: Promise.resolve(undefined) })).locale).toBe('en');
  });

  it('reads no request header, so it opts no page into dynamic rendering', async () => {
    const source = (await import('node:fs')).readFileSync(new URL('./request.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/next\/headers|\bheaders\(|\bcookies\(/);
  });
});
