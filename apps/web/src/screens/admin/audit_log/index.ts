// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminScreen } from '@/screens/types';
import { AuditLogScreen } from './Screen';

// Registered for admin.audit_log (screens/registry.ts loads this file lazily; it runs nothing at import time).
export const screen: AdminScreen = AuditLogScreen;
