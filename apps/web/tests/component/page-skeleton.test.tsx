import { describe, expect, it } from 'vitest';

import { PageSkeleton } from '@/components/patterns/page-skeleton';

import { render, screen } from '../helpers/render';

// Arbitrary ASCII loading label — the assertions only need the same string back
// as the region's accessible name.
const LABEL = 'Yukleniyor';

// StatStrip's shared grid class — the marker that a (bare) StatStripSkeleton
// strip band was rendered under the header.
const STRIP_GRID = '.lg\\:grid-flow-col';
// The framed header's internal hairline between the title band and the strip.
// Scoped to `.border-border` so it never collides with the StatStrip cells'
// own `.border-border-muted.border-t`.
const FRAMED_DIVIDER = '.border-border.border-t';
// Raised-surface signature shared by the header Card and the data panel
// (bg-card + rounded-lg + shadow-xs). Skeleton bars use bg-surface-skeleton +
// rounded-sm, so they never match.
const RAISED_SURFACE = '.bg-card.rounded-lg.shadow-xs';

describe('PageSkeleton', () => {
  it('default render keeps the flat header anatomy — no framed Card, no stat strip', () => {
    render(<PageSkeleton label={LABEL} />);
    const region = screen.getByRole('status', { name: LABEL });

    // Only the data panel is a raised surface; the header is a plain
    // border-bottom band, so the extra framed header Card is absent.
    expect(region.querySelectorAll(RAISED_SURFACE)).toHaveLength(1);
    expect(region.querySelector(FRAMED_DIVIDER)).toBeNull();
    // statCells defaults to 0, so there is no strip band either.
    expect(region.querySelector(STRIP_GRID)).toBeNull();
  });

  it('framed folds the title band and stat strip into one Card divided by a hairline', () => {
    render(<PageSkeleton label={LABEL} framed statCells={4} />);
    const region = screen.getByRole('status', { name: LABEL });

    // Two raised surfaces now: the header Card (title band + strip) and the
    // data panel below it.
    expect(region.querySelectorAll(RAISED_SURFACE)).toHaveLength(2);
    // statCells > 0 draws the internal divider and the bare strip band.
    expect(region.querySelector(FRAMED_DIVIDER)).not.toBeNull();
    expect(region.querySelector(STRIP_GRID)).not.toBeNull();
  });

  it('framed with no stat cells keeps the header Card but drops the divider and strip', () => {
    render(<PageSkeleton label={LABEL} framed />);
    const region = screen.getByRole('status', { name: LABEL });

    // Header Card + data panel are still both raised...
    expect(region.querySelectorAll(RAISED_SURFACE)).toHaveLength(2);
    // ...but with statCells=0 the divider and strip are gone.
    expect(region.querySelector(FRAMED_DIVIDER)).toBeNull();
    expect(region.querySelector(STRIP_GRID)).toBeNull();
  });

  it('framed withBackLink renders the back-link line above the title', () => {
    render(<PageSkeleton label={LABEL} framed withBackLink statCells={4} />);
    const region = screen.getByRole('status', { name: LABEL });

    // The back-link line (w-40) precedes the title line (w-64) in document order.
    const backLink = region.querySelector('.w-40');
    const title = region.querySelector('.w-64');
    expect(backLink).not.toBeNull();
    expect(title).not.toBeNull();
    expect(
      backLink!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
