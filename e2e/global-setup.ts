// SPDX-License-Identifier: AGPL-3.0-only
import { buildTemplate, startSharedApi, stackEnabled } from '../scripts/e2e-stack';

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  if (!stackEnabled()) return undefined;
  const dropTemplate = await buildTemplate();
  const stopShared = await startSharedApi().catch(async (error: unknown) => {
    await dropTemplate();
    throw error;
  });
  return async () => {
    await stopShared();
    await dropTemplate();
  };
}
