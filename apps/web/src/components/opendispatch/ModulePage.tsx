// SPDX-License-Identifier: AGPL-3.0-only
import type { ModuleAccessResult, ModuleDef } from '@/lib/access';
import type { ModuleState } from './module-state';
import { ScreenFrame } from './ScreenFrame';

interface ModulePageProps {
  def: ModuleDef;
  access: ModuleAccessResult;
  state: ModuleState;
  /** The role's landing page, for the no-access state. */
  homeHref: string | undefined;
}

/**
 * The placeholder page of a module that has no screen yet (kept for any module
 * until its screen is registered in screens/registry.ts): the ScreenFrame with no content, so it is the module's
 * title, the data-source badge, "View only" or "Reduced", and one of the four states, empty by default. No figures, no
 * table, no explanation. The badge reads Synthetic because in demo mode everything is; a real screen passes the data_source
 * of the records it shows.
 */
export function ModulePage({ def, access, state, homeHref }: ModulePageProps) {
  return <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} placeholder />;
}
