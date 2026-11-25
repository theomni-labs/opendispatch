// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminScreen } from '@/screens/types';
import { SecurityComplianceScreen } from './Screen';

// Registered for admin.security_compliance (screens/registry.ts loads this file lazily; it runs nothing at import time).
export const screen: AdminScreen = SecurityComplianceScreen;
