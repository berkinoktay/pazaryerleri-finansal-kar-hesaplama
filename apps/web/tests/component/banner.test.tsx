import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Banner } from '@/components/patterns/banner';

import { render, screen } from '../helpers/render';

describe('<Banner>', () => {
  it('renders the title', () => {
    render(<Banner title="Bakım penceresi" />);
    expect(screen.getByText('Bakım penceresi')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <Banner
        title="Bakım penceresi"
        description="Pazar 03:00–04:00 arası kısa kesinti olabilir."
      />,
    );
    expect(
      screen.getByText('Pazar 03:00–04:00 arası kısa kesinti olabilir.', { exact: false }),
    ).toBeInTheDocument();
  });

  it('applies the correct tone classes per variant', () => {
    const { rerender, container } = render(<Banner title="Info" tone="info" />);
    expect(container.firstElementChild?.className).toContain('text-info');

    rerender(<Banner title="Warning" tone="warning" />);
    expect(container.firstElementChild?.className).toContain('text-warning');

    rerender(<Banner title="Destructive" tone="destructive" />);
    expect(container.firstElementChild?.className).toContain('text-destructive');
  });

  it('omits the dismiss button when onDismiss is not provided', () => {
    render(<Banner title="x" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('fires onDismiss when the dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    const { user } = render(<Banner title="x" onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('honours a custom dismissLabel for the aria-label', () => {
    render(<Banner title="x" onDismiss={() => {}} dismissLabel="Kapat" />);
    expect(screen.getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
  });

  it('renders the action slot when supplied', () => {
    render(<Banner title="x" action={<button type="button">Detayları gör</button>} />);
    expect(screen.getByRole('button', { name: 'Detayları gör' })).toBeInTheDocument();
  });

  it('exposes role="status" for assistive tech', () => {
    render(<Banner title="x" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
