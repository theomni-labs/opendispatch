# Access model

Who sees which module, in which install mode, and who may approve what. Pure TypeScript with no imports from next,
react, fixtures or the data layer (a test checks this), so the data layer and both shells can import it. The api
enforces the same matrix in Go (`apps/api-go/internal/access`), and the contract carries it as `x-modules` in
`contracts/openapi.yaml`.

```ts
import { menuFor, moduleAccess, defaultLanding, canApprove, zoneAllowed } from '@/lib/access';
```

| File | Contents |
|---|---|
| `types.ts` | `Role`, `Console`, `Access`, `InstallMode`, `ZoneScope`, `ModuleId`, `ModuleDef`, approval types, runtime guards |
| `modules.ts` | The 30 module definitions and the menu groups |
| `matrix.ts` | The matrix as data, install-mode differences, role availability, scopes, approvers |
| `access.ts` | The functions below |
| `*.test.ts` | Module list, matrix against an independent literal table, install modes, approvals, scope, purity |

## Functions

| Function | Returns |
|---|---|
| `moduleAccess(role, moduleId, installMode)` | `{ access: 'none' \| 'view' \| 'edit', reduced: boolean }` |
| `rolesForInstallMode(mode)` | 7 roles in private installs, 6 otherwise (no Change Approver) |
| `menuFor(role, mode)` | `{ console, groups: { group, groupKey, items: ModuleDef[] }[] }[]`, only items with access, in module order |
| `canSeeConsole(role, console, mode?)` | true if the role has at least one module there |
| `defaultLanding(role, mode)` | `{ console, moduleId }`, or `null` when the menu is empty |
| `scopeAppliesTo(role)` | `'whole_install' \| 'assigned_zones' \| 'remote_pool'` |
| `zoneScopeFor(role, zoneIds?)` | A `ZoneScope` for the request context (zone list ignored for whole install and remote pool) |
| `zoneAllowed(scope, zoneId)` | boolean |
| `canApprove({ role, requesterUserId, approverUserId, kind, installMode? })` | boolean |
| `checkApproval(same)` | `{ allowed: true }` or `{ allowed: false, reason }`, for a disabled control |
| `approvalKindsFor(role, mode)` | The approval kinds the shell may show Approve and Reject for |

Every function fails closed: an unknown role, install mode, module or console gets `none`, an empty menu, no landing
and no approval.

i18n keys: `nav.<console>.<module>.title`, `nav.<console>.<module>.menu`, `nav.<console>.group.<group>`.

## Matrix

E = edit, V = view, A = may approve or reject (with view access), - = not in the menu. Columns: Administrator,
Dispatch Supervisor, Dispatcher, Planner, Remote Team Lead, Viewer / Auditor, Change Approver. This is a private
install; the differences in other modes follow the tables.

**Ops console**

| # | Module | Group | Adm | Sup | Disp | Plan | RTL | View | CA |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Forecast Explorer | Plan | V | V | V | V | V | V | - |
| 2 | Live Dispatch Board | Live | V | E | E | V | - | V | - |
| 3 | Remote Queue and Scheduling | Live | V | V | - | V | E | V | - |
| 4 | Field Planner Workbench | Plan | V | E, A | - | E | - | V | - |
| 5 | Standby and Coverage Map | Plan | V | V | V | E | - | V | - |
| 6 | Gap and Surplus | Analyze | V | V | - | E | V | V | - |
| 7 | Service-Level Simulator | Analyze | V | V | - | E | - | V | - |
| 8 | Scenario Lab | Analyze | V | V | - | E | - | V | - |
| 9 | Leave Planner | Plan | V | V | - | E, A | - | V | - |
| 10 | Break Planner | Plan | V | V | - | E | - | V | - |
| 11 | Management Dashboards | Analyze | V | V | - | E | V | V | - |
| 12 | Productivity and Metrics | Analyze | V | V | - | V | - | V | - |

**Admin console**

| # | Module | Group | Adm | Sup | Disp | Plan | RTL | View | CA |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Users and Roles | Access | E | - | - | - | - | - | - |
| 2 | Sign-in and Identity Providers | Access | E (shared: V) | - | - | - | - | - | - |
| 3 | Locations | Reference data | E | - | - | - | - | - | - |
| 4 | Agents and Vehicles | Reference data | E | - | - | - | - | - | - |
| 5 | Classification Rules | Reference data | E | A | - | - | - | - | - |
| 6 | Shift and Break Policies | Reference data | E | - | - | - | - | - | - |
| 7 | Leave Policy and Calendar | Reference data | E | - | - | - | - | - | - |
| 8 | Forecast and Model Admin | Operations | E | - | - | - | - | - | - |
| 9 | Data Sources and Integrations | Operations | E | - | - | - | - | - | - |
| 10 | Data Import and Quality | Operations | E | - | - | - | - | - | - |
| 11 | Audit Log | System | V | - | - | - | - | V | V |
| 12 | Notifications and Alerts | Operations | E | - | - | - | - | - | - |
| 13 | API and Webhooks | Operations | E | - | - | - | - | - | - |
| 14 | Security and Compliance | System | E | - | - | - | - | - | - |
| 15 | System Health | System | E | - | - | - | - | - | - |
| 16 | Updates | System | E (dedicated, shared: V, reduced) | - | - | - | - | - | A |
| 17 | Localization | System | E | - | - | - | - | - | - |
| 18 | AI Assistant | System | E | - | - | - | - | V | - |

**Install modes.** The Change Approver exists only in private installs; elsewhere it has no menu, no access, no
landing and approves nothing. The Administrator keeps Updates in every mode: full screen in private installs,
`view` with `reduced: true` (version and release notes only) in dedicated and shared installs. `reduced` is true in
that one case only. Sign-in and Identity Providers is `view` for the Administrator in shared installs, where
providers are set up for the tenant. Nothing else changes with the mode.

**Groups.** Ops: Live (2, 3), Plan (1, 4, 5, 9, 10), Analyze (6, 7, 8, 11, 12). Admin: Access (1, 2), Reference data
(3 to 7), Operations (8, 9, 10, 12, 13), System (11, 14 to 18). Items keep module number order inside a group;
consoles are ordered Ops, Admin.

**Scope.** Administrator, Viewer / Auditor, Change Approver: whole install. Dispatch Supervisor, Dispatcher, Planner:
assigned zones. Remote Team Lead: the remote pool, which matches no zone id (`zoneAllowed` is false), so remote work
is handled by the pool.

**Approvals.** Nobody approves their own request. Classification rules, rosters and overrides: Dispatch Supervisor.
Leave: Planner. Updates: Change Approver (private installs). The Administrator approves nothing. `canApprove` does not
check zones; a caller with assigned zones also checks `zoneAllowed(approverScope, requestZone)`.

**Default landing.** The first module, in menu order, where the role can edit or approve; otherwise the first module
in its menu; `null` for an empty menu. So: Administrator, Admin Users and Roles; Dispatch Supervisor and Dispatcher,
Ops Live Dispatch Board; Planner, Ops Field Planner Workbench; Remote Team Lead, Ops Remote Queue; Viewer / Auditor,
Ops Live Dispatch Board; Change Approver, Admin Updates.

## Design choices

1. **Approve is not an access level.** `Access` is none, view or edit. Approving comes from `approvalKindsFor` and
   `canApprove`, so the Dispatch Supervisor can approve rules without being able to draft them, and the Change
   Approver can approve updates without applying them.
2. **The Audit Log is view only for everyone,** the Administrator included. It is append only.
3. **Leave approver is the Planner,** the only role with edit access to the Leave Planner. To let the Dispatch
   Supervisor approve leave, add it to `APPROVER_ROLES.leave` in `matrix.ts` and give it edit on module 9 (and update
   the Go matrix and `x-modules` to match).
4. **The live-assignment stage per zone** is set in Admin, Data Sources and Integrations and shown read only on the
   Live Dispatch Board.
5. **Module ids and i18n keys** are stable slugs (`ops.remote_queue`, `admin.forecast_model`, `admin.data_sources`,
   `admin.sign_in_identity`, ...). `menuLabelEn` is a short menu label; `titleEn` is the full title.

## Run the tests

```sh
pnpm exec vitest run apps/web/src/lib/access
```
