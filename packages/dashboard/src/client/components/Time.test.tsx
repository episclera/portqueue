/**
 * @jest-environment jsdom
 *
 * `<Time>` is the only place the dashboard turns an instant into text, so its two behaviours are
 * worth pinning: the em dash for a missing value, and a label that does not move on its own.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@portqueue/ui';
import { Time } from './Time';
import { formatDateTime, formatDateTimeParts } from './format';

describe('<Time>', () => {
  it('renders the em dash for a missing or unparseable value', () => {
    const { container, rerender } = render(<Time value={null} />);
    expect(container.textContent).toBe('—');
    rerender(<Time value="not a date" />);
    expect(container.textContent).toBe('—');
  });

  it('renders the exact local timestamp and the UTC instant for machines', () => {
    const iso = new Date(2026, 2, 12, 13, 23, 1).toISOString();
    render(<Time value={iso} />);

    const label = screen.getByText(formatDateTime(Date.parse(iso)));
    expect(label.tagName).toBe('TIME');
    // The visible label is local; `dateTime` and the hover title carry the unambiguous UTC form.
    expect(label).toHaveAttribute('dateTime', iso);
    expect(label).toHaveAttribute('title', iso);
  });

  it('renders the same text however many times it re-renders', () => {
    // The label is a pure function of the prop — no `Date.now()`, so nothing to drift. A parent
    // re-render (a poll, a filter change) can't turn one instant into two different labels.
    const iso = new Date(2026, 2, 12, 13, 23, 1).toISOString();
    const { container, rerender } = render(<Time value={iso} />);
    const first = container.textContent;
    rerender(<Time value={iso} />);
    rerender(<Time value={iso} />);
    expect(container.textContent).toBe(first);
  });

  describe('stacked', () => {
    const ISO = new Date(2026, 2, 12, 13, 23, 1).toISOString();
    const renderStacked = (): HTMLElement =>
      render(
        <ThemeProvider mode="light">
          <Time value={ISO} stacked />
        </ThemeProvider>,
      ).container;

    it('puts the timezone on its own line, below the instant', () => {
      const container = renderStacked();
      const { instant, offset } = formatDateTimeParts(Date.parse(ISO))!;

      // Two separate elements, not one wrapped string — the offset is styled independently.
      expect(screen.getByText(offset)).toBeInTheDocument();
      expect(getComputedStyle(screen.getByText(offset)).display).toBe('block');
      // Same facts, same order as the inline form.
      expect(container.textContent).toBe(`${instant}${offset}`);
    });

    it('keeps the machine-readable UTC instant that the inline form carries', () => {
      renderStacked();
      // Stacking is presentational: `dateTime`/`title` must not change with it, or a stacked
      // cell would stop being comparable against a UTC log.
      const el = screen.getByTitle(ISO);
      expect(el.tagName).toBe('TIME');
      expect(el).toHaveAttribute('dateTime', ISO);
    });

    it('still renders the em dash for a missing value', () => {
      const { container } = render(
        <ThemeProvider mode="light">
          <Time value={null} stacked />
        </ThemeProvider>,
      );
      expect(container.textContent).toBe('—');
    });
  });
});
