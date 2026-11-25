// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminScreen } from '@/screens/types';
import { LeavePolicyCalendarScreen } from './Screen';

// Registered for admin.leave_policy_calendar (screens/registry.ts loads this file lazily; it runs nothing at import time).
export const screen: AdminScreen = LeavePolicyCalendarScreen;
