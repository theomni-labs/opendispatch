// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { HeaderActions } from './management_dashboards/HeaderActions';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/x', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

const here = import.meta.dirname;
const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });

describe('Ops exports are honest stubs', () => {
  it('no Ops screen toasts "exported" for an export that is not built', () => {
    const offenders = sources(here).filter((file) => /toast\(\{\s*title:\s*[mt]\('toast\.export'\)/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(here, f))).toEqual([]);
  });

  it('says the export is not built, in both languages', async () => {
    inLocale('en', <HeaderActions />, { module: 'ops.management_dashboards' });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Export not built yet')).toBeTruthy();
    cleanup();
    inLocale('ar', <HeaderActions />, { module: 'ops.management_dashboards' });
    fireEvent.click(screen.getByRole('button', { name: 'تصدير' }));
    expect(await screen.findByText('التصدير لم يُبنَ بعد')).toBeTruthy();
  });
});
