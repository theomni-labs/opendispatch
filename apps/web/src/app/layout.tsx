// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';

// The <html> element is rendered by app/[locale]/layout.tsx so that lang and dir are correct on the
// server, on first paint.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
