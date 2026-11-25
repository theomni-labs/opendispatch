// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionError } from '@/components/opendispatch/patterns/ActionError';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { ActionResult } from '@/lib/actions/types';
import type { ExportFile } from './download';
import { useExport } from './use-export';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/audit-log', useRouter: () => router }));
const saved = vi.hoisted(() => vi.fn());
vi.mock('./download', async (original) => ({ ...(await original<typeof import('./download')>()), downloadText: saved }));

afterEach(() => {
  cleanup();
  saved.mockReset();
});

const file: ExportFile = { filename: 'audit-log.csv', mime: 'text/csv;charset=utf-8', text: 'a,b' };

function Harness({ action }: { action: () => Promise<ActionResult<ExportFile>> }) {
  const exporter = useExport(action);
  return (
    <div>
      <button type="button" onClick={() => exporter.run()}>export</button>
      <ActionError error={exporter.error} onDismiss={exporter.reset} />
    </div>
  );
}
const click = () => act(async () => void fireEvent.click(screen.getByRole('button', { name: 'export' })));

describe('useExport', () => {
  it('saves what the action returns and says the export is ready, with the file name', async () => {
    inLocale('en', <Harness action={async () => ({ ok: true, data: file })} />);
    await click();
    await waitFor(() => expect(saved).toHaveBeenCalledWith(file));
    expect(await screen.findByText('Export ready')).toBeTruthy();
    expect(screen.getByText('audit-log.csv')).toBeTruthy();
  });

  it('saves nothing and shows the failure when the action is refused', async () => {
    inLocale('en', <Harness action={async () => ({ ok: false, code: 'forbidden', message: 'Not allowed.' })} />);
    await click();
    expect((await screen.findByRole('alert')).textContent).toContain('Your role cannot do that.');
    expect(saved).not.toHaveBeenCalled();
  });

  it('says the export is ready in Arabic', async () => {
    inLocale('ar', <Harness action={async () => ({ ok: true, data: file })} />);
    await click();
    expect(await screen.findByText('الملف جاهز')).toBeTruthy();
  });
});
