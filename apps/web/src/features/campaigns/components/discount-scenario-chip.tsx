'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { DiscountBasketScenario } from '../lib/adapt-discount-list';

export interface DiscountScenarioChipProps {
  /**
   * The single-product-basket settlement scenario; null for NET (and non-positive prices), which
   * renders nothing — only basket-scoped discount types carry a scenario.
   */
  scenario: DiscountBasketScenario | null;
  /**
   * The row's DISPLAYED discounted unit price (a 2dp string) — the "settlement-basis unit amount"
   * shown in the popover. Backend guarantees it equals basketPaidTotal / assumedQuantity, so the
   * chip never contradicts the row it sits beside. Purely rendered — no client-side money math.
   */
  unitPrice: string;
}

/**
 * A small muted quantity chip (rendering the `scenario.chip` label) that opens a click Popover
 * explaining the assumed single-product basket behind a basket-scoped discount's per-unit
 * settlement amount. Basket-scoped discounts
 * (CONDITIONAL_BASKET / CONDITIONAL_QUANTITY / CODE / BUY_X_PAY_Y / NTH_PRODUCT) never change the
 * showcase price — the effective unit amount is what settlement runs on — so the chip surfaces the
 * assumed quantity (n), the list-price basket, the basket discount, what the customer pays, and the
 * settlement-basis unit amount. Renders nothing for NET (scenario null), whose price genuinely
 * changes and reads as a plain discounted price.
 *
 * Composed from the shared {@link Popover} primitive (click-triggered, portaled, closes on outside
 * click / Escape) — the same idiom as the commission bands popover. The trigger is a real
 * `<button>` (keyboard + screen-reader reachable) and stops click propagation so opening the chip
 * never triggers an enclosing row action. Every figure is backend-computed; this only renders.
 */
export function DiscountScenarioChip({
  scenario,
  unitPrice,
}: DiscountScenarioChipProps): React.ReactElement | null {
  const t = useTranslations('discountsPage.scenario');

  // NET (and non-positive prices) carry no scenario: the discounted price reads plainly, no chip.
  if (scenario === null) return null;

  const qty = scenario.assumedQuantity;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('chipAria', { qty })}
          onClick={(event) => event.stopPropagation()}
          className="text-2xs bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-ring duration-fast ease-out-quart px-2xs py-3xs inline-flex shrink-0 cursor-pointer items-center rounded-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-2"
        >
          {t('chip', { qty })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="px-lg w-auto min-w-56">
        <div className="gap-3xs mb-sm flex flex-col">
          <span className="text-foreground text-xs font-medium">{t('title')}</span>
          <span className="text-2xs text-muted-foreground">{t('subtitle')}</span>
        </div>
        <ul className="gap-2xs flex flex-col">
          <li className="gap-x-md text-2xs flex items-center justify-between tabular-nums">
            <span className="text-muted-foreground">{t('assumedBasket', { qty })}</span>
            <Currency value={scenario.basketTotal} className="text-foreground shrink-0" />
          </li>
          <li className="gap-x-md text-2xs flex items-center justify-between tabular-nums">
            <span className="text-muted-foreground">{t('basketDiscount')}</span>
            {/* Signed as a reduction — the "−" sits flush against the amount as one unit. */}
            <span className="text-foreground shrink-0">
              <span>−</span>
              <Currency value={scenario.basketDiscountTotal} />
            </span>
          </li>
          <li className="gap-x-md text-2xs flex items-center justify-between tabular-nums">
            <span className="text-muted-foreground">{t('paidTotal')}</span>
            <Currency value={scenario.basketPaidTotal} className="text-foreground shrink-0" />
          </li>
          <li className="gap-x-md text-2xs flex items-center justify-between tabular-nums">
            <span className="text-muted-foreground">{t('unitSettlement')}</span>
            <Currency value={unitPrice} className="text-foreground shrink-0" />
          </li>
        </ul>
        <p className="text-2xs text-muted-foreground border-border mt-sm pt-sm border-t">
          {t('distributionNote')}
        </p>
      </PopoverContent>
    </Popover>
  );
}
