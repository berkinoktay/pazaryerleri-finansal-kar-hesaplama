import { describe, expect, it } from 'vitest';

import { StatStrip, StatStripSkeleton, type StatStripItem } from '@/components/patterns/stat-strip';

import { render, screen } from '../helpers/render';

// Fixed, ASCII-only config with plain string values (no money/intl formatting)
// so the tests exercise surface/size behavior, not the currency pipeline.
const ITEMS: StatStripItem[] = [
  { label: 'Revenue', value: '1.250' },
  { label: 'Orders', value: '84' },
];

// A single item carrying a `context` line — exercises the "only the value size
// changes across `size`" contract and the `mt-auto` bottom-anchoring of the
// context/delta line.
const CONTEXT_ITEMS: StatStripItem[] = [
  { label: 'Revenue', value: '1.250', context: 'Awaiting export' },
];

describe('<StatStrip> size + surface', () => {
  it('renders the large value size and the card entrance by default', () => {
    const { container } = render(<StatStrip items={ITEMS} />);

    // Style contract: default size is `lg` (text-3xl) on the value line.
    expect(screen.getByText('1.250')).toHaveClass('text-3xl');
    // The card surface owns the entrance animation.
    expect(container.querySelector('.animate-panel-enter')).not.toBeNull();
  });

  it('renders the medium value size', () => {
    render(<StatStrip items={ITEMS} size="md" />);
    expect(screen.getByText('1.250')).toHaveClass('text-2xl');
  });

  it('renders the small value size', () => {
    render(<StatStrip items={ITEMS} size="sm" />);
    expect(screen.getByText('1.250')).toHaveClass('text-xl');
  });

  it('keeps the context line fixed while only the value size changes across sizes', () => {
    const { rerender } = render(<StatStrip items={CONTEXT_ITEMS} size="sm" />);

    // Small size: the value shrinks to text-xl, but the context line stays text-2xs.
    expect(screen.getByText('1.250')).toHaveClass('text-xl');
    expect(screen.getByText('Awaiting export')).toHaveClass('text-2xs');

    rerender(<StatStrip items={CONTEXT_ITEMS} size="lg" />);

    // Large size: the value grows to text-3xl, yet the context line is unchanged.
    expect(screen.getByText('1.250')).toHaveClass('text-3xl');
    expect(screen.getByText('Awaiting export')).toHaveClass('text-2xs');
  });

  it('bottom-anchors the context line with mt-auto', () => {
    render(<StatStrip items={CONTEXT_ITEMS} />);

    // The context text lives in a wrapper pinned to the cell bottom so the small
    // lines read as one aligned row when a sibling value wraps.
    expect(screen.getByText('Awaiting export').parentElement).toHaveClass('mt-auto');
  });

  it('drops the card surface, shadow, and entrance under surface="bare"', () => {
    const { container } = render(<StatStrip items={ITEMS} surface="bare" />);

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    // Bare is a plain grid: no entrance and none of the Card chrome classes.
    expect(root).not.toHaveClass('animate-panel-enter');
    expect(root).not.toHaveClass('shadow-xs');
    expect(root).not.toHaveClass('border');
    // The items still render.
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });
});

describe('<StatStrip> loading', () => {
  it('exposes a named busy region and keeps labels while skeletoning values', () => {
    render(<StatStrip items={ITEMS} loading loadingLabel="Loading" />);

    const region = screen.getByRole('status', { name: 'Loading' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');
    // Labels come from static config and stay put; values become skeletons.
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.queryByText('1.250')).not.toBeInTheDocument();
  });

  it('keeps identical loading semantics under surface="bare"', () => {
    render(<StatStrip items={ITEMS} loading loadingLabel="Loading" surface="bare" />);

    const region = screen.getByRole('status', { name: 'Loading' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.queryByText('1.250')).not.toBeInTheDocument();
  });
});

describe('<StatStripSkeleton>', () => {
  it('wraps a card with the entrance animation and one child per cell by default', () => {
    const { container } = render(<StatStripSkeleton cells={3} />);

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    // Default 'card' surface owns the entrance animation (the framed shell does not).
    expect(root).toHaveClass('animate-panel-enter');
    // One direct child cell per requested cell.
    expect(root?.children).toHaveLength(3);
  });

  it('renders a plain grid of the requested cell count under surface="bare"', () => {
    const { container } = render(<StatStripSkeleton surface="bare" cells={3} />);

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    // Bare skeleton is not wrapped in a Card: no entrance animation.
    expect(root).not.toHaveClass('animate-panel-enter');
    // One direct child per requested cell.
    expect(root?.children).toHaveLength(3);
  });
});
