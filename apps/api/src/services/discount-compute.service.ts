// Per-list discount configuration, narrowed from the DiscountList row by the
// validator's discriminated union. Every V1 kurgu reduces to ONE contract:
// effectiveUnitPrice — the per-unit selling price under the "single-product
// basket at the minimum qualifying quantity + proportional split" assumption
// (design §5.1). The profit engine never learns discount types.

import { Decimal } from 'decimal.js';

export type DiscountConfig =
  | { readonly type: 'NET'; readonly valueKind: 'AMOUNT' | 'PERCENT'; readonly value: Decimal }
  | {
      readonly type: 'CONDITIONAL_BASKET';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minBasketAmount: Decimal;
    }
  | {
      readonly type: 'CONDITIONAL_QUANTITY';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minQuantity: number;
    }
  | { readonly type: 'BUY_X_PAY_Y'; readonly buyQuantity: number; readonly payQuantity: number }
  | {
      readonly type: 'NTH_PRODUCT';
      readonly valueKind: 'AMOUNT' | 'PERCENT' | 'FIXED_PRICE';
      readonly value: Decimal;
      readonly nthIndex: number;
    }
  | {
      readonly type: 'CODE';
      readonly valueKind: 'AMOUNT' | 'PERCENT';
      readonly value: Decimal;
      readonly minBasketAmount: Decimal;
    };

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/** price × (1 − pct/100), floored at 0. */
function applyPercent(price: Decimal, pct: Decimal): Decimal {
  return Decimal.max(price.mul(Decimal.sub(1, pct.div(HUNDRED))), ZERO);
}

/** price − amount, floored at 0. */
function applyAmount(price: Decimal, amount: Decimal): Decimal {
  return Decimal.max(price.sub(amount), ZERO);
}

/**
 * The minimum quantity of THIS product whose single-product basket satisfies the
 * min-basket condition. A zero/negative price cannot qualify — the caller guards.
 */
function qualifyingQuantity(price: Decimal, minBasketAmount: Decimal): number {
  return Math.max(minBasketAmount.div(price).ceil().toNumber(), 1);
}

/**
 * Per-unit effective selling price under the single-product-basket assumption
 * (design §5.1). Full-precision Decimal — serialization rounds at the DTO edge.
 */
export function effectiveUnitPrice(price: Decimal, config: DiscountConfig): Decimal {
  if (price.lte(ZERO)) return ZERO;

  switch (config.type) {
    case 'NET':
      return config.valueKind === 'PERCENT'
        ? applyPercent(price, config.value)
        : applyAmount(price, config.value);
    case 'CONDITIONAL_BASKET':
    case 'CODE': {
      if (config.valueKind === 'PERCENT') return applyPercent(price, config.value);
      const n = qualifyingQuantity(price, config.minBasketAmount);
      return applyAmount(price, config.value.div(n));
    }
    case 'CONDITIONAL_QUANTITY':
      return config.valueKind === 'PERCENT'
        ? applyPercent(price, config.value)
        : applyAmount(price, config.value.div(Math.max(config.minQuantity, 1)));
    case 'BUY_X_PAY_Y':
      return price.mul(config.payQuantity).div(config.buyQuantity);
    case 'NTH_PRODUCT': {
      const n = Math.max(config.nthIndex, 1);
      const discountedUnit =
        config.valueKind === 'PERCENT'
          ? applyPercent(price, config.value)
          : config.valueKind === 'AMOUNT'
            ? applyAmount(price, config.value)
            : Decimal.max(config.value, ZERO); // FIXED_PRICE
      return price
        .mul(n - 1)
        .add(discountedUnit)
        .div(n);
    }
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unhandled discount config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
