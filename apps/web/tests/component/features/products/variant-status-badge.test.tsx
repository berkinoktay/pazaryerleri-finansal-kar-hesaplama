import { describe, expect, it } from 'vitest';

import { ProductVariantStatus } from '@pazarsync/db/enums';

import { VariantStatusBadge } from '@/features/products/components/variant-status-badge';
import type { KnownStatusReason } from '@/features/products/lib/variant-status';

import trMessages from '../../../../messages/tr.json';
import { makeVariantSummary } from '../../../helpers/product-fixtures';
import { render, screen, within } from '../../../helpers/render';

const statusBadge = trMessages.products.statusBadge;
const statusReasons = trMessages.products.statusReasons;
const delistedLabel = trMessages.products.table.variantDelisted;

function reasonButtonName(label: string): string {
  return statusBadge.reasonAria.replace('{label}', label);
}

const REASON_CASES: ReadonlyArray<{
  status: ProductVariantStatus;
  label: string;
  reason: KnownStatusReason;
}> = [
  {
    status: ProductVariantStatus.LOCKED,
    label: statusBadge.locked,
    reason: 'CRITICAL_SALE_PRICE_CHANGE',
  },
  {
    status: ProductVariantStatus.BLACKLISTED,
    label: statusBadge.blacklisted,
    reason: 'UNAPPROVED_BRAND_CATEGORY_SPM',
  },
];

describe('VariantStatusBadge', () => {
  it('renders nothing for a listed, on-sale variant', () => {
    const { container } = render(
      <VariantStatusBadge
        variant={makeVariantSummary({
          status: ProductVariantStatus.ON_SALE,
          quantity: 0,
          statusReason: null,
          delistedAt: null,
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    { quantity: 0, shown: statusBadge.outOfStock, hidden: statusBadge.closed },
    { quantity: 3, shown: statusBadge.closed, hidden: statusBadge.outOfStock },
  ])(
    'labels a not-on-sale variant with $quantity in stock by its stock',
    ({ quantity, shown, hidden }) => {
      render(
        <VariantStatusBadge
          variant={makeVariantSummary({
            status: ProductVariantStatus.NOT_ON_SALE,
            quantity,
            statusReason: null,
            delistedAt: null,
          })}
        />,
      );
      expect(screen.getByText(shown)).toBeInTheDocument();
      expect(screen.queryByText(hidden)).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('shows the delisted badge instead of the status badge', () => {
    render(
      <VariantStatusBadge
        variant={makeVariantSummary({
          status: ProductVariantStatus.LOCKED,
          quantity: 4,
          statusReason: 'CRITICAL_SALE_PRICE_CHANGE',
          delistedAt: '2026-10-20T09:00:00Z',
        })}
      />,
    );
    expect(screen.getByText(delistedLabel)).toBeInTheDocument();
    expect(screen.queryByText(statusBadge.locked)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(REASON_CASES)(
    'opens a popover with the localized $reason reason on click',
    async ({ status, label, reason }) => {
      const { user } = render(
        <VariantStatusBadge
          variant={makeVariantSummary({
            status,
            quantity: 4,
            statusReason: reason,
            delistedAt: null,
          })}
        />,
      );
      const trigger = screen.getByRole('button', { name: reasonButtonName(label) });
      expect(trigger).toHaveClass('cursor-pointer');
      expect(screen.queryByRole('dialog')).toBeNull();

      await user.click(trigger);

      const popover = within(await screen.findByRole('dialog'));
      expect(popover.getByText(statusBadge.reasonTitle)).toBeInTheDocument();
      expect(popover.getByText(statusReasons[reason])).toBeInTheDocument();
    },
  );

  it.each([{ reason: 'SOME_FUTURE_REASON' }, { reason: null }])(
    'renders a plain badge without a button for reason $reason',
    ({ reason }) => {
      render(
        <VariantStatusBadge
          variant={makeVariantSummary({
            status: ProductVariantStatus.LOCKED,
            quantity: 4,
            statusReason: reason,
            delistedAt: null,
          })}
        />,
      );
      expect(screen.getByText(statusBadge.locked)).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
});
