/**
 * Fills the jsdom gaps antd reaches for, so component tests render the real components rather
 * than stubs of them. A no-op under the node environment the server tests run in.
 *
 * - `matchMedia`: antd's grid, table and descriptions subscribe to breakpoints. Nothing matches,
 *   which reads as the smallest screen — the queries are about layout, never behaviour.
 * - `ResizeObserver`: antd's tables, menus and overflow lists observe their own size. jsdom lays
 *   nothing out, so there is never a size to report — a silent observer is the honest stand-in.
 * - `getComputedStyle(el, pseudo)`: antd measures the scrollbar through a pseudo-element, which
 *   jsdom does not implement and reports as a console error on every modal. The pseudo argument is
 *   dropped, so the call answers for the element itself.
 */
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });
  }

  if (!('ResizeObserver' in window)) {
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserver });
    Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: ResizeObserver });
  }

  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => getComputedStyle(element);
}
