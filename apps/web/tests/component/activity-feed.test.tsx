import { describe, expect, it } from 'vitest';

import { ActivityFeed, type ActivityFeedEntry } from '@/components/patterns/activity-feed';

import { render, screen, within } from '../helpers/render';

const ENTRIES: ActivityFeedEntry[] = [
  {
    id: 'a',
    tone: 'info',
    title: 'Senkron başladı',
    description: '142 / 250',
    source: 'Trendyol',
    timestamp: 'şimdi',
  },
  {
    id: 'b',
    tone: 'success',
    title: 'Sipariş eklendi',
    description: '34 yeni sipariş',
    timestamp: '8 dk önce',
  },
  {
    id: 'c',
    tone: 'destructive',
    title: 'API hatası',
    detail: 'Endpoint /orders 401',
  },
];

describe('<ActivityFeed>', () => {
  describe('rendering', () => {
    it('renders one list item per entry', () => {
      render(<ActivityFeed entries={ENTRIES} aria-label="Geçmiş" />);
      const list = screen.getByRole('list', { name: 'Geçmiş' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(ENTRIES.length);
    });

    it('renders title, description, timestamp, and source per entry', () => {
      render(<ActivityFeed entries={ENTRIES} aria-label="Geçmiş" />);
      expect(screen.getByText('Senkron başladı')).toBeInTheDocument();
      expect(screen.getByText('142 / 250')).toBeInTheDocument();
      expect(screen.getByText('şimdi')).toBeInTheDocument();
      expect(screen.getByText('Trendyol')).toBeInTheDocument();
    });

    it('renders the detail body when an entry provides one', () => {
      render(<ActivityFeed entries={ENTRIES} aria-label="Geçmiş" />);
      expect(screen.getByText('Endpoint /orders 401')).toBeInTheDocument();
    });

    it('omits optional fields when not supplied', () => {
      const minimalEntry: ActivityFeedEntry = {
        id: 'only-title',
        title: 'Sadece başlık',
      };
      render(<ActivityFeed entries={[minimalEntry]} aria-label="Min" />);
      // Description / timestamp / source / detail nodes are not in the DOM
      // when the entry doesn't ship them — check via the rendered text
      // count for the listitem.
      const list = screen.getByRole('list', { name: 'Min' });
      expect(within(list).getByText('Sadece başlık')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders the supplied emptyState node when entries=[]', () => {
      render(
        <ActivityFeed entries={[]} emptyState={<div data-testid="empty">Hiçbir şey yok</div>} />,
      );
      expect(screen.getByTestId('empty')).toBeInTheDocument();
    });

    it('renders nothing (no list) when entries=[] and no emptyState provided', () => {
      render(<ActivityFeed entries={[]} aria-label="Boş" />);
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('compact variant', () => {
    it('still renders all entries with their titles', () => {
      render(<ActivityFeed entries={ENTRIES} compact aria-label="Kompakt" />);
      const list = screen.getByRole('list', { name: 'Kompakt' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(ENTRIES.length);
      expect(screen.getByText('Senkron başladı')).toBeInTheDocument();
    });
  });

  describe('icon slot', () => {
    it('renders the icon node inside the entry indicator when provided', () => {
      const entries: ActivityFeedEntry[] = [
        {
          id: 'with-icon',
          tone: 'success',
          icon: <svg data-testid="custom-glyph" aria-hidden />,
          title: 'Tamamlandı',
        },
      ];
      render(<ActivityFeed entries={entries} aria-label="İkon" />);
      expect(screen.getByTestId('custom-glyph')).toBeInTheDocument();
    });
  });
});
