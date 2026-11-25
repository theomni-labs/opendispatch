// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import config, { SECURITY_HEADERS } from '../apps/web/next.config';

describe('next.config security headers', () => {
  it('sends the headers on every path', async () => {
    const rules = await config.headers?.();
    expect(rules).toEqual([{ source: '/:path*', headers: [...SECURITY_HEADERS] }]);
  });

  it('forbids framing and sniffing', () => {
    const map = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(map['X-Frame-Options']).toBe('DENY');
    expect(map['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('next.config design system wiring', () => {
  it('transpiles @opendispatch/ui, which ships TypeScript source and CSS Modules', () => {
    expect(config.transpilePackages).toContain('@opendispatch/ui');
  });

  it('keeps the monorepo root as the Turbopack and tracing root, because packages/ sits beside apps/', () => {
    expect(config.outputFileTracingRoot).toBeTypeOf('string');
    expect(config.turbopack?.root).toBe(config.outputFileTracingRoot);
  });
});

describe('next.config server action upload limit', () => {
  // The imports send a file as text, up to 8,000,000 characters (an Arabic character is two bytes), and Next's default is
  // 1 MB. 10 MB is also the proxy's body clone ceiling (`proxyClientMaxBodySize`, 10,485,760 by default).
  it('raises the server action body limit to 10 MB, the proxy ceiling', () => {
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe('10mb');
  });

  it('keeps the security headers, the transpiled UI package and the Turbopack root beside it', async () => {
    expect(await config.headers?.()).toHaveLength(1);
    expect(config.transpilePackages).toContain('@opendispatch/ui');
    expect(config.turbopack?.root).toBe(config.outputFileTracingRoot);
  });
});
