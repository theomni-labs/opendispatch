// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomInt } from 'node:crypto';

// Demo creds, made once per run.
export function ensureEmergencyAdminCreds(): { password: string; code: string } {
  const password = (process.env['DEMO_EMERGENCY_ADMIN_PASSWORD'] ||= randomBytes(18).toString('base64url'));
  const code = (process.env['DEMO_EMERGENCY_ADMIN_TOTP'] ||= String(randomInt(100_000, 1_000_000)));
  return { password, code };
}
