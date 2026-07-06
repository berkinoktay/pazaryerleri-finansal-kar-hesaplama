import { describe, expect, it } from 'vitest';

import { PageHeader } from '@/components/patterns/page-header';

import { render, screen } from '../helpers/render';

// compareDocumentPosition bit: set on the return value when the argument node
// FOLLOWS the reference node in document order.
const DOCUMENT_POSITION_FOLLOWING = 4;

describe('<PageHeader> plain variant', () => {
  it('renders the title, intent, summary, and the leading/badge/meta slots on a bordered band', () => {
    const { container } = render(
      <PageHeader
        title="Orders"
        intent="April period"
        leading={<div>LEADING_MARK</div>}
        badge={<div>BADGE_MARK</div>}
        meta={<div>META_MARK</div>}
        summary={<div>SUMMARY_MARK</div>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('April period')).toBeInTheDocument();
    expect(screen.getByText('SUMMARY_MARK')).toBeInTheDocument();
    // All three optional slots render visibly under the plain band.
    expect(screen.getByText('LEADING_MARK')).toBeInTheDocument();
    expect(screen.getByText('BADGE_MARK')).toBeInTheDocument();
    expect(screen.getByText('META_MARK')).toBeInTheDocument();
    // Surface contract: plain is the border-bottom band, never a raised Card.
    expect(container.querySelector('header')).toHaveClass('border-b');
    expect(container.querySelector('.bg-card')).toBeNull();
  });

  it('places filters before actions in the same right cluster', () => {
    render(
      <PageHeader
        title="Orders"
        filters={<div>FILTERS_MARK</div>}
        actions={<div>ACTIONS_MARK</div>}
      />,
    );

    const filters = screen.getByText('FILTERS_MARK');
    const actions = screen.getByText('ACTIONS_MARK');

    // Both live in the shared cluster, and filters comes first in DOM order.
    expect(filters.parentElement).toBe(actions.parentElement);
    expect(filters.compareDocumentPosition(actions) & DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('ignores hero and filterChips (framed-only slots)', () => {
    render(
      <PageHeader
        title="Orders"
        hero={{ value: 'HERO_VALUE' }}
        filterChips={<div>CHIP_MARK</div>}
      />,
    );

    expect(screen.queryByText('HERO_VALUE')).not.toBeInTheDocument();
    expect(screen.queryByText('CHIP_MARK')).not.toBeInTheDocument();
  });
});

describe('<PageHeader> framed variant', () => {
  it('renders the title-first layout on a raised Card when no hero is given', () => {
    const { container } = render(
      <PageHeader
        variant="framed"
        title="Orders"
        intent="April period"
        summary={<div>SUMMARY_MARK</div>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('April period')).toBeInTheDocument();
    expect(screen.getByText('SUMMARY_MARK')).toBeInTheDocument();
    // Surface contract: framed lifts the header onto a Card and drops the band border.
    expect(container.querySelector('.bg-card')).not.toBeNull();
    expect(container.querySelector('header')).not.toHaveClass('border-b');
  });

  it('renders the framed-title meta in the right cluster, above the controls row', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        intent="April period"
        meta={<div>META_MARK</div>}
        filters={<div>FILTERS_MARK</div>}
        actions={<div>ACTIONS_MARK</div>}
      />,
    );

    const meta = screen.getByText('META_MARK');
    const filters = screen.getByText('FILTERS_MARK');
    expect(meta).toBeInTheDocument();
    // Status row (meta) precedes the controls row (filters/actions) in DOM order.
    expect(meta.compareDocumentPosition(filters) & DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('lifts the framed-title meta out of the title column (not stacked under intent)', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        intent="April period"
        meta={<div>META_MARK</div>}
        actions={<div>ACTIONS_MARK</div>}
      />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Orders' });
    const meta = screen.getByText('META_MARK');
    // The left column wraps the heading (title row → column); framed title mode
    // renders meta in the right cluster instead, so that column must NOT contain it.
    const titleColumn = heading.closest('div')?.parentElement;
    expect(titleColumn).not.toBeNull();
    expect(titleColumn?.contains(meta)).toBe(false);
  });

  it('renders the metric mode when a ready hero is given (caption replaces intent)', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        intent="April period"
        hero={{ value: 'HERO_VALUE', caption: 'CAPTION_MARK' }}
      />,
    );

    // Title identity stays a level-1 heading; the star figure and its caption show.
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('HERO_VALUE')).toBeInTheDocument();
    expect(screen.getByText('CAPTION_MARK')).toBeInTheDocument();
    // Metric mode drops the intent line — the caption stands in its place.
    expect(screen.queryByText('April period')).not.toBeInTheDocument();
    // Typography step-down: title shrinks to text-lg, the star figure leads at text-5xl.
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toHaveClass('text-lg');
    expect(screen.getByText('HERO_VALUE')).toHaveClass('text-5xl');
  });

  it('keeps meta on the identity row (with the small title) in metric mode, before the hero', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        meta={<div>META_MARK</div>}
        hero={{ value: 'HERO_VALUE', caption: 'CAPTION_MARK' }}
      />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Orders' });
    const meta = screen.getByText('META_MARK');
    const hero = screen.getByText('HERO_VALUE');

    // Metric mode keeps meta inline on the identity row next to the small title,
    // NOT migrated into the right cluster.
    expect(meta.parentElement).toBe(heading.parentElement);
    // ...and it precedes the star figure in DOM order.
    expect(meta.compareDocumentPosition(hero) & DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('shows a busy region and hides the hero value while loading', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        hero={{ value: 'HERO_VALUE', status: 'loading' }}
      />,
    );

    const busy = screen.getByRole('status');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('HERO_VALUE')).not.toBeInTheDocument();
    // The title identity stays stable across the loading transition.
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
  });

  it('falls back to title-first when the hero is empty (intent returns)', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        intent="April period"
        hero={{ value: 'HERO_VALUE', status: 'empty' }}
      />,
    );

    expect(screen.queryByText('HERO_VALUE')).not.toBeInTheDocument();
    expect(screen.getByText('April period')).toBeInTheDocument();
  });

  it('falls back to title-first when the hero errors (intent returns)', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        intent="April period"
        hero={{ value: 'HERO_VALUE', status: 'error' }}
      />,
    );

    expect(screen.queryByText('HERO_VALUE')).not.toBeInTheDocument();
    expect(screen.getByText('April period')).toBeInTheDocument();
  });

  it('renders both the filter-chip strip and the summary when given', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        filterChips={<div>CHIP_MARK</div>}
        summary={<div>SUMMARY_MARK</div>}
      />,
    );

    expect(screen.getByText('CHIP_MARK')).toBeInTheDocument();
    expect(screen.getByText('SUMMARY_MARK')).toBeInTheDocument();

    // Chips govern the summary metrics, so they render ABOVE (before) them in DOM order.
    const chip = screen.getByText('CHIP_MARK');
    const summary = screen.getByText('SUMMARY_MARK');
    expect(chip.compareDocumentPosition(summary) & DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('places filters before actions in the same right cluster', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        filters={<div>FILTERS_MARK</div>}
        actions={<div>ACTIONS_MARK</div>}
      />,
    );

    const filters = screen.getByText('FILTERS_MARK');
    const actions = screen.getByText('ACTIONS_MARK');

    // Same shared cluster, filters first in DOM order — mirrors the plain variant.
    expect(filters.parentElement).toBe(actions.parentElement);
    expect(filters.compareDocumentPosition(actions) & DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('names the loading region with the caller-provided loadingLabel', () => {
    render(
      <PageHeader
        variant="framed"
        title="Orders"
        hero={{ value: 'HERO_VALUE', status: 'loading', loadingLabel: 'Loading' }}
      />,
    );

    const busy = screen.getByRole('status', { name: 'Loading' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });
});
