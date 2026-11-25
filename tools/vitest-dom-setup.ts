// SPDX-License-Identifier: AGPL-3.0-only
// Browser APIs jsdom lacks and Ant Design reads: matchMedia (responsive helpers) and ResizeObserver (overflow
// measurement). Only filled in when a test runs in jsdom and the API is missing; a test may still stub its own.
if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    class NoResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = NoResizeObserver as unknown as typeof ResizeObserver;
  }
}
