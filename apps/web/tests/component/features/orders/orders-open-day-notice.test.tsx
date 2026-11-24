import { createTranslator } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { OpenDayMatch, OrderListOpenDay } from '@/features/orders/api/list-orders.api';
import { OrdersOpenDayNotice } from '@/features/orders/components/orders-open-day-notice';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Copy comes from the catalog, never a literal: the Turkish values will change.
const t = createTranslator({
  locale: 'tr',
  messages: trMessages,
  namespace: 'ordersPage.openDay',
});

const STORED_ID = '00000000-0000-0000-0000-0000000000a1';
const CANCELLED_ID = '00000000-0000-0000-0000-0000000000a2';
const BUFFER_ID = '00000000-0000-0000-0000-0000000000b1';

const STORED: OpenDayMatch = {
  source: 'orders',
  id: STORED_ID,
  orderNumber: 'TY-TODAY-1',
  cancelled: false,
};
const CANCELLED: OpenDayMatch = {
  source: 'orders',
  id: CANCELLED_ID,
  orderNumber: 'TY-TODAY-2',
  cancelled: true,
};
const BUFFERED: OpenDayMatch = {
  source: 'buffer',
  id: BUFFER_ID,
  orderNumber: 'TY-TODAY-3',
  cancelled: false,
};

// Inert past dates: the component reads only finalizing, matches and the count.
function openDay(over: Partial<OrderListOpenDay> = {}): OrderListOpenDay {
  return {
    businessDate: '2026-05-15',
    lastCompletedBusinessDate: '2026-05-14',
    finalizing: false,
    todayOrderCount: 0,
    matches: [],
    ...over,
  };
}

function linkHref(name: string): string | null {
  return screen.getByRole('link', { name }).getAttribute('href');
}

describe('<OrdersOpenDayNotice>', () => {
  it('renders nothing without finalizing, matches or today orders', () => {
    const { container, rerender } = render(<OrdersOpenDayNotice openDay={openDay()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<OrdersOpenDayNotice openDay={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the finalizing note', () => {
    render(<OrdersOpenDayNotice openDay={openDay({ finalizing: true })} />);
    expect(screen.getByText(t('finalizing'))).toBeInTheDocument();
  });

  it('links a stored match to its live-performance deep link', () => {
    render(<OrdersOpenDayNotice openDay={openDay({ matches: [STORED] })} />);
    expect(screen.getByText(t('matchesTitle', { count: 1 }))).toBeInTheDocument();
    expect(linkHref(t('matchStored', { orderNumber: STORED.orderNumber }))).toBe(
      `/live-performance?order=${STORED_ID}`,
    );
  });

  it('links a cancelled match to the cancelled tab', () => {
    render(<OrdersOpenDayNotice openDay={openDay({ matches: [CANCELLED] })} />);
    expect(linkHref(t('matchCancelled', { orderNumber: CANCELLED.orderNumber }))).toBe(
      '/live-performance?ordersFilter=cancelled',
    );
  });

  it('links a buffered match to its own sheet on live performance', () => {
    render(<OrdersOpenDayNotice openDay={openDay({ matches: [BUFFERED] })} />);
    expect(linkHref(t('matchPending', { orderNumber: BUFFERED.orderNumber }))).toBe(
      `/live-performance?buffer=${BUFFERED.id}`,
    );
  });

  it('shows both the note and the links when both apply', () => {
    render(
      <OrdersOpenDayNotice
        openDay={openDay({ finalizing: true, matches: [STORED, CANCELLED, BUFFERED] })}
      />,
    );
    expect(screen.getByText(t('finalizing'))).toBeInTheDocument();
    expect(screen.getByText(t('matchesTitle', { count: 3 }))).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows the today notice with a live-performance link when today has orders', () => {
    render(<OrdersOpenDayNotice openDay={openDay({ todayOrderCount: 2 })} />);
    expect(screen.getByText(t('todayNotice'))).toBeInTheDocument();
    expect(linkHref(t('todayLink'))).toBe('/live-performance');
  });

  it('leaves the today notice out when today has no orders', () => {
    render(<OrdersOpenDayNotice openDay={openDay({ finalizing: true, todayOrderCount: 0 })} />);
    // Control: the notice itself renders (finalizing), only the today line is absent.
    expect(screen.getByText(t('finalizing'))).toBeInTheDocument();
    expect(screen.queryByText(t('todayNotice'))).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t('todayLink') })).not.toBeInTheDocument();
  });
});
