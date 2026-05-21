// Re-exports for settlement transaction handlers (PR-7 commits 3..7).
//
//   - handleSale       (commit 3) — Sale → OrderItem grossCommission*
//   - handleDiscount   (commit 3) — Discount → OrderItem refundedCommission* + sellerDiscount*
//   - handleReturn     (commit 3) — Return → OrderFee REFUND_DEDUCTION
//   - handlePsfStoppage (commit 4) — placeholder
//   - handlePaymentOrderEntry (commit 5) — placeholder
//   - handleCommissionInvoice (commit 6) — placeholder
//   - handleFastDeliveryCorrection (commit 7) — placeholder

export { handleSale, type HandleSettlementResult } from './sale';
export { handleDiscount } from './discount';
export { handleReturn } from './return';
export { handlePsf } from './psf';
export { handleStoppage } from './stoppage';
export { handleAdvertising } from './advertising';
export { handlePaymentOrderEntry, type HandlePaymentOrderEntryResult } from './payment-order';
export { handleCommissionInvoice, type HandleCommissionInvoiceResult } from './commission-invoice';
