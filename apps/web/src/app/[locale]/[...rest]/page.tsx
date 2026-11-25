// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from 'next/navigation';

// Any path the app has no page for renders the locale's 404 page (not-found.tsx), inside the locale layout, so the
// <html lang dir> and the language stay right.
export default function CatchAll() {
  notFound();
}
