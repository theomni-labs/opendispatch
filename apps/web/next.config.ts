// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Response headers that need no per-request state. A Content-Security-Policy needs nonces and is added with the
// real sign-in in oidc mode; until then these limit framing, sniffing and referrer leakage.
export const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
] as const;

const config: NextConfig = {
  // packages/ui publishes TypeScript source and CSS Modules; antd and its icons ship ES modules that Next bundles as they are.
  transpilePackages: ['@opendispatch/ui'],
  // libvips (LGPL) is removed from the tree, so no server-side image optimisation.
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  // A second build output for parallel work (NEXT_DIST_DIR=.next-a1 pnpm build): agents and the lead can each test their own build.
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  // The web image sets NEXT_OUTPUT=standalone; other builds are unchanged.
  ...(process.env['NEXT_OUTPUT'] === 'standalone' ? { output: 'standalone' as const } : {}),
  async headers() {
    return [{ source: '/:path*', headers: [...SECURITY_HEADERS] }];
  },
  // packages/ sits beside apps/web, so the monorepo root is the tracing and Turbopack root.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  experimental: {
    // Server actions accept 1 MB by default. Imports send the file as text (up to 8,000,000 characters, and an
    // Arabic character is two bytes) and the update file up to 2,000,000, so the limit is raised to 10 MB. That is also
    // the ceiling: the proxy (src/proxy.ts) clones request bodies up to `proxyClientMaxBodySize`, default 10 MB, and
    // cuts the rest. The screens' own limits stay well under it; their upload hints show those figures in bytes
    // ("up to 7.6 MB"), not this 10 MB ceiling.
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default withNextIntl(config);
