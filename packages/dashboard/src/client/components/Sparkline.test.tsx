/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline.js';

describe('Sparkline', () => {
  it('renders a flat baseline line when given fewer than two values', () => {
    const { getByRole } = render(<Sparkline values={[]} />);
    const svg = getByRole('img', { name: 'sparkline' });
    expect(svg.querySelector('line')).toBeInTheDocument();
    expect(svg.querySelector('polyline')).toBeNull();
  });

  it('renders a polyline with one point per value', () => {
    const { getByRole } = render(<Sparkline values={[1, 5, 2, 8]} />);
    const polyline = getByRole('img', { name: 'sparkline' }).querySelector('polyline');
    expect(polyline).toBeInTheDocument();
    const points = polyline?.getAttribute('points')?.trim().split(' ') ?? [];
    expect(points).toHaveLength(4);
  });

  it('honors width and height props', () => {
    const { getByRole } = render(<Sparkline values={[1, 2]} width={120} height={40} />);
    const svg = getByRole('img', { name: 'sparkline' });
    expect(svg).toHaveAttribute('width', '120');
    expect(svg).toHaveAttribute('height', '40');
  });
});
