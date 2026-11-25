// SPDX-License-Identifier: AGPL-3.0-only
// The titles of the eleven seeded controls in the reader's language. The data layer gives `title_en` only; the
// mockup has the Arabic of these eleven, looked up by the control's own reference. A control this map does not know (a later addition)
// shows the data layer's English title, marked as English. Plain constants: server and client files may both import this.

/** The message key (under the module) of a control's title, by control reference. */
export const TITLE_KEY: Readonly<Record<string, string>> = {
  'NCA-AC-01': 'c.1.t',
  'NCA-AC-02': 'c.2.t',
  'NCA-LG-01': 'c.3.t',
  'NCA-CR-01': 'c.4.t',
  'NCA-BK-01': 'c.5.t',
  'NCA-IR-01': 'c.6.t',
  'PDPL-DR-01': 'c.7.t',
  'PDPL-RT-01': 'c.8.t',
  'PDPL-SR-01': 'c.9.t',
  'PDPL-XB-01': 'c.10.t',
  'OpenDispatch-SUP-01': 'c.11.t',
};
