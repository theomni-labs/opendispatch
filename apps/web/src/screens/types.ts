// SPDX-License-Identifier: AGPL-3.0-only
// The contract between the module route and an Admin screen (.
//
// A screen is a Server Component. ModuleRoute builds the request context on the server, checks the
// access model, and only then renders the screen, so a screen never runs for a role with no access to its module and can
// call its data functions with `ctx` without asking. It renders a `ScreenFrame` and puts its content inside.
//
//   export async function UsersRolesScreen({ def, ctx, access, homeHref, state, searchParams }: ScreenProps) {
//     const emptyAction =...;                     // depends on `access`, not on data
//     return (
//       <ScreenFrame def={def} access={access} state={state} homeHref={homeHref} actions={...} emptyAction={emptyAction}>
//         <UsersBody ctx={ctx} query={...} />      // an async Server Component: it fetches, so it runs only when filled
//       </ScreenFrame>
//     );
//   }
//
// `ctx` is for Server Components and data functions only. It is never a prop of a client component and never an
// argument of a server action (actions build their own with requireRequestContext(); tools/rules/context-rules.test.ts).

import type { ReactNode } from 'react';
import type { ModuleState } from '@/components/opendispatch/module-state';
import type { ModuleAccessResult, ModuleDef } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';

/** The parsed query string of the page. Values are untrusted: a screen validates each against an allow-list. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export interface ScreenProps {
  def: ModuleDef;
  /** Built on the server from the session cookie (demo mode) or the token (oidc mode). */
  ctx: RequestContext;
  /** `view` or `edit`, never `none`: ModuleRoute shows the no-access page before a screen runs. `reduced` as the model says. */
  access: ModuleAccessResult;
  locale: string;
  /** The role's landing page, for the frame's no-access state. */
  homeHref: string | undefined;
  /** PHASE A DEMO TOOLING: pass it to the frame. Undefined means show the content. */
  state: ModuleState | undefined;
  searchParams: SearchParams;
}

/** A screen: a Server Component, sync or async. The name predates Ops screens; it fits both consoles unchanged. */
export type AdminScreen = (props: ScreenProps) => ReactNode | Promise<ReactNode>;
/** Alias of AdminScreen for an Ops module's `screens/ops/<module>/index.ts`, which is console-agnostic underneath. */
export type Screen = AdminScreen;

/** What every `screens/admin/<module>/index.ts` or `screens/ops/<module>/index.ts` exports: its screen, or undefined until built. */
export interface ScreenModule {
  screen: AdminScreen | undefined;
}
