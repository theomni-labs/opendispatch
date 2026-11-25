// SPDX-License-Identifier: AGPL-3.0-only
import type { Screen } from '@/screens/types';
import { RemoteQueueScreen } from './Screen';

// Registered for ops.remote_queue, lazy.
export const screen: Screen = RemoteQueueScreen;
