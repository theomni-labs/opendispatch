// SPDX-License-Identifier: AGPL-3.0-only
// Types for status.mjs (plain JavaScript), so TypeScript files (review-sheet.ts, the tests) can import it.

export type Tree = { [key: string]: string | Tree };
export declare const ROOT: string;
export declare const STATUS_NOTE: string;
export declare function leaves(tree: Tree, prefix?: string): Record<string, string>;
export declare function paths(root?: string): {
  messages: string;
  core: (locale: string) => string;
  scope: (scope: string, locale: string) => string;
  status: string;
};
export declare function statusScopes(root?: string): Record<string, Record<string, string>>;
export declare function syncStatus(root?: string, options?: { write?: boolean }): { added: string[]; removed: string[] };
