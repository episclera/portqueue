/**
 * The horizontal-scroll affordance a wide table sits in. jsdom does no layout — every element
 * reports a zero width — so the overflow metrics are stubbed per test to describe the three
 * positions that matter: fits, scrolled to the start, scrolled to the end.
 *
 * What's asserted is the *contract*, not the pixels: a fade appears only on a clipped edge, and
 * it never intercepts a click meant for the row underneath it.
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { ScrollShadow, ThemeProvider } from '@portqueue/ui';

/** Fades are decorative, so they carry no role — find them by what marks them decorative. */
const fades = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
];

const visible = (container: HTMLElement): HTMLElement[] =>
  fades(container).filter((el) => getComputedStyle(el).opacity === '1');

/**
 * Describe an overflow state to a layout-free DOM. `scrollWidth`/`clientWidth` are read-only
 * getters on HTMLElement, so they are redefined on the instance the component measures — the
 * viewport, which is the element wrapping the table (the two fades are its siblings).
 */
function stubScroller(
  container: HTMLElement,
  box: { scrollWidth: number; clientWidth: number; scrollLeft: number },
): HTMLElement {
  const el = container.querySelector('table')?.parentElement;
  if (!el) throw new Error('scroll viewport not found');
  Object.defineProperty(el, 'scrollWidth', { value: box.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: box.clientWidth, configurable: true });
  el.scrollLeft = box.scrollLeft;
  return el;
}

const renderShadow = (): { container: HTMLElement } =>
  render(
    <ThemeProvider mode="light">
      <ScrollShadow>
        <table>
          <tbody>
            <tr>
              <td>a wide table</td>
            </tr>
          </tbody>
        </table>
      </ScrollShadow>
    </ThemeProvider>,
  );

/** Re-measure the way a real scroll or viewport change would, flushing the state update. */
const scroll = (el: HTMLElement, to?: number): void => {
  act(() => {
    if (to !== undefined) el.scrollLeft = to;
    el.dispatchEvent(new Event('scroll'));
  });
};

describe('ScrollShadow', () => {
  it('shows no fade when the content fits', () => {
    const { container } = renderShadow();
    const el = stubScroller(container, { scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
    scroll(el);

    expect(visible(container)).toHaveLength(0);
  });

  it('fades only the right edge at the start of a scrollable table', () => {
    const { container } = renderShadow();
    const el = stubScroller(container, { scrollWidth: 900, clientWidth: 400, scrollLeft: 0 });
    scroll(el);

    // There is more to the right, and nothing hidden to the left yet.
    expect(visible(container)).toHaveLength(1);
  });

  it('fades both edges mid-scroll and only the left edge at the end', () => {
    const { container } = renderShadow();
    const el = stubScroller(container, { scrollWidth: 900, clientWidth: 400, scrollLeft: 250 });
    scroll(el);
    expect(visible(container)).toHaveLength(2);

    scroll(el, 500); // 900 - 400 — the far end.
    expect(visible(container)).toHaveLength(1);
  });

  it('never intercepts a click meant for the content beneath it', () => {
    const { container } = renderShadow();
    const el = stubScroller(container, { scrollWidth: 900, clientWidth: 400, scrollLeft: 0 });
    scroll(el);

    // A fade sits over the table edge; pointer-events must stay off or it would swallow the
    // click on the row (and on any row action pinned to the right-hand column).
    for (const fade of fades(container)) {
      expect(getComputedStyle(fade).pointerEvents).toBe('none');
    }
    expect(screen.getByText('a wide table')).toBeInTheDocument();
  });
});
