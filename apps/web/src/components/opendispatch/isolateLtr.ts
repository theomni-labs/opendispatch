// SPDX-License-Identifier: AGPL-3.0-only
// Keeps "95%" whole inside Arabic text.
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}
