// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminScreen } from '@/screens/types';
import { DataImportQualityScreen } from './Screen';

// Registered for admin.data_import_quality (screens/registry.ts loads this file lazily; it runs nothing at import time).
export const screen: AdminScreen = DataImportQualityScreen;
