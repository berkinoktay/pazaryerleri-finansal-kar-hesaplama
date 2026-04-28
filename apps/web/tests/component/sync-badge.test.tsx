import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { SyncBadge } from '@/components/patterns/sync-badge';
import { render, screen } from '@/../tests/helpers/render';

// Minimal subset of `common.*` keys SyncBadge consumes. Real translations
// can drift; the test only cares that the right key was looked up and
// substitution worked, not what the Turkish copy says.
const messages = {
  common: {
    lastSynced: 'Son senkron',
    gmtOffset: 'GMT+03:00',
    activeSyncCount: '{n} senkron',
  },
};

function renderBadge(props: Partial<React.ComponentProps<typeof SyncBadge>> = {}) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <SyncBadge state="fresh" lastSyncedAt={null} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('SyncBadge', () => {
  describe('branching on activeCount', () => {
    it('renders the single-sync surface when activeCount is undefined (legacy callers)', () => {
      renderBadge({});
      expect(screen.getByText('Son senkron')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders the single-sync surface when activeCount is 0', () => {
      // Regression: an earlier implementation returned null on activeCount=0,
      // which hid the SyncCenter entry point on a fresh install and made the
      // products page un-syncable. The fresh / never-synced state must always
      // be visible — it's also the trigger surface.
      renderBadge({ activeCount: 0 });
      expect(screen.getByText('Son senkron')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders the single-sync surface when activeCount is 1', () => {
      renderBadge({ activeCount: 1, state: 'fresh' });
      expect(screen.getByText('Son senkron')).toBeInTheDocument();
    });

    it('renders the multi-sync pill when activeCount >= 2', () => {
      renderBadge({ activeCount: 3 });
      // Single-sync surface markers must be absent…
      expect(screen.queryByText('Son senkron')).not.toBeInTheDocument();
      // …and the count must be in the rendered text.
      expect(screen.getByText(/3/)).toBeInTheDocument();
    });
  });

  describe('interactivity', () => {
    it('renders the single-sync variant as a button when onClick is provided', () => {
      const onClick = vi.fn();
      renderBadge({ activeCount: 0, onClick, ariaLabel: 'SyncCenter ı aç' });
      expect(screen.getByRole('button', { name: 'SyncCenter ı aç' })).toBeInTheDocument();
    });

    it('renders the multi-sync variant as a button when onClick is provided', () => {
      const onClick = vi.fn();
      renderBadge({ activeCount: 5, onClick, ariaLabel: 'SyncCenter ı aç' });
      expect(screen.getByRole('button', { name: 'SyncCenter ı aç' })).toBeInTheDocument();
    });
  });
});
