// SPDX-License-Identifier: AGPL-3.0-only
import type { AdminScreen } from '@/screens/types';
import { ApiWebhooksScreen } from './Screen';

// Registered for admin.api_webhooks (screens/registry.ts loads this file lazily; it runs nothing at import time).
export const screen: AdminScreen = ApiWebhooksScreen;
