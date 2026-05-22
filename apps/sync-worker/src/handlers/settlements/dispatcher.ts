// Per-row dispatch — routes a single Trendyol settlement / otherfinancials
// transaction to the right handler based on the dispatcher target produced
// by @pazarsync/marketplace's `classifySettlementTransaction` /
// `classifyOtherFinancialTransaction`.
//
// All handlers run inside the caller's transaction so the cron loop can
// scope each row to its own $transaction (per-row isolation; one bad row
// doesn't poison the cycle).

import type { Prisma } from '@pazarsync/db';
import {
  classifyOtherFinancialTransaction,
  classifySettlementTransaction,
  type OtherFinancialTransactionType,
  type SettlementTransactionType,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import {
  handleAdvertising,
  handleCommissionInvoice,
  handleDiscount,
  handlePaymentOrderEntry,
  handlePsf,
  handleReturn,
  handleSale,
  handleStoppage,
} from './index';

export async function dispatchSettlementRow(
  storeId: string,
  _organizationId: string,
  requestedType: SettlementTransactionType,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const target = classifySettlementTransaction(requestedType);
  switch (target.kind) {
    case 'order_item_update':
      if (target.semantics === 'sale') {
        // BUG #8 diagnostic — trace that the Sale row actually reaches the
        // dispatch site. Removed once the silent-failure root cause is
        // identified.
        syncLog.info('settlements.dispatcher.sale-route', {
          id: row.id,
          shipmentPackageId: row.shipmentPackageId,
        });
        await handleSale(storeId, row, tx);
      } else if (target.semantics === 'discount') {
        await handleDiscount(storeId, row, tx);
      } else {
        // 'coupon' — research §3.3 zero observations in 60 days; audit log only
        syncLog.info('settlements.coupon.audit', { id: row.id });
      }
      break;
    case 'order_fee_insert':
      if (target.feeType === 'REFUND_DEDUCTION') {
        await handleReturn(storeId, row, tx);
      } else {
        // Provision/ManualRefund/SellerRevenue/Commission ± Cancel:
        // research §3.3 zero observations in 60 days. V1 audit log only —
        // raw OrderFee insert for rare types deferred to V2 once stage
        // produces a concrete row.
        syncLog.info('settlements.rare-fee-type.audit', {
          id: row.id,
          feeType: target.feeType,
          direction: target.direction,
        });
      }
      break;
    case 'compensating':
    case 'no_op':
      syncLog.info('settlements.dispatcher.skip', {
        id: row.id,
        kind: target.kind,
        requestedType,
      });
      break;
  }
}

export async function dispatchOtherFinancialRow(
  storeId: string,
  organizationId: string,
  requestedType: OtherFinancialTransactionType,
  row: TrendyolFinancialTransaction,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const target = classifyOtherFinancialTransaction(requestedType, row);
  switch (target.kind) {
    case 'payment_order_cycle':
      await handlePaymentOrderEntry(storeId, organizationId, row, tx);
      break;
    case 'org_period_fee_audit':
      // Stoppage — period-level audit
      await handleStoppage(storeId, organizationId, row, tx);
      break;
    case 'deduction_invoice':
      switch (target.subClass.kind) {
        case 'platform_service_fee':
          await handlePsf(storeId, organizationId, row, tx);
          break;
        case 'advertising':
          await handleAdvertising(storeId, organizationId, row, tx);
          break;
        case 'commission_invoice':
          await handleCommissionInvoice(storeId, organizationId, row, tx);
          break;
        case 'cargo_invoice':
          // PR-8 scope — dispatcher only logs the trigger; cargo handler
          // hits the cargo-invoice/{serial}/items endpoint separately.
          syncLog.info('settlements.cargo-invoice.deferred-pr8', { id: row.id });
          break;
        case 'penalty':
        case 'notification_fee':
        case 'unknown':
          syncLog.info('settlements.deduction-invoice.audit', {
            id: row.id,
            subClass: target.subClass.kind,
          });
          break;
      }
      break;
    case 'audit_log_raw':
      syncLog.info('settlements.other-financial.audit', {
        id: row.id,
        transactionType: target.transactionType,
      });
      break;
  }
}
