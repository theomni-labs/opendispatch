// SPDX-License-Identifier: AGPL-3.0-only
// A message file as the web serves it ({customer})
import fs from 'node:fs';
import path from 'node:path';
import { fillCustomer, pickCustomerShortName, type Messages } from '../apps/web/src/i18n/message-tree';

/** The run's short name: the same env as the web. */
export function customerName(locale: string): string {
  return pickCustomerShortName(locale, process.env['OPENDISPATCH_CUSTOMER_SHORT_NAME'], process.env['OPENDISPATCH_CUSTOMER_SHORT_NAME_AR']);
}

/** Reads `<dir>/en.json` or `ar.json`, {customer} filled. */
export function readMessages(file: string): Messages {
  const locale = path.basename(file, '.json');
  return fillCustomer(JSON.parse(fs.readFileSync(file, 'utf8')) as Messages, customerName(locale));
}
