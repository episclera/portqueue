/**
 * @jest-environment jsdom
 *
 * `<Time>` is the only place the dashboard turns an instant into text, so its two behaviours are
 * worth pinning: the em dash for a missing value, and a label that does not move on its own.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Time } from './Time';
import { formatDateTime } from './format';

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
});
