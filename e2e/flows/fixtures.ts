// SPDX-License-Identifier: AGPL-3.0-only
import { test as base, type ServerScope } from '../fixtures';

export { expect } from '../fixtures';

// One database per describe: one per language.
export const test = base.extend({ serverScope: 'describe' as ServerScope });
