// SPDX-License-Identifier: AGPL-3.0-only
import { LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import type { Console } from '@/lib/access';

// The icon of a console on the rail and in the navigation drawer (the mockup's `layout-dashboard` and `settings`).
// Both names were checked against lucide-react's type declarations.
const CONSOLE_ICONS: Readonly<Record<Console, LucideIcon>> = {
  ops: LayoutDashboard,
  admin: Settings,
};

export function ConsoleIcon({ console }: { console: Console }) {
  const Icon = CONSOLE_ICONS[console];
  return <Icon aria-hidden="true" />;
}
