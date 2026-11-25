// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminScreen } from '@/screens/types';
import { ShiftBreakPoliciesScreen } from './Screen';

// Registered for admin.shift_break_policies (screens/registry.ts loads this file lazily; it runs nothing at import time).
export const screen: AdminScreen = ShiftBreakPoliciesScreen;
