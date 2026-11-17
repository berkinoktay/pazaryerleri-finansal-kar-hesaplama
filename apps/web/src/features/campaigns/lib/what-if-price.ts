import { Decimal } from 'decimal.js';

/**
 * The highest price a custom-price input accepts when nothing tighter bounds it: about
 * 10M TL, far above any real Trendyol price. Without it a separator-free ten-digit entry
 * would reach about 10 billion, stretch the profit badge past the cell, and overflow the
 * stored custom price column (numeric(12,2)) on save.
 */
export const MAX_WHAT_IF_PRICE = new Decimal('9999999.99');
