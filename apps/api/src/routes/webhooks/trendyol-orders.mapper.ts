/**
 * Webhook payload → MappedOrder DTO.
 *
 * Reuses `@pazarsync/marketplace`'s `mapTrendyolShipmentPackage` (PR-A) but
 * applies two webhook-specific overrides:
 *
 *   1. Status mapping comes from the receiver route (which already produced
 *      a non-null OrderStatus via `mapTrendyolStatusToEnum`). We override
 *      the mapper's status fallback so the routed status sticks.
 *
 *   2. `createdBy === 'transfer'` → status forced to CANCELLED. Per
 *      webhook-model.md, a transfer means Trendyol forwarded the package to
 *      another seller; from our DB's POV the package is no longer ours.
 *      Sync flow doesn't see transfers (getShipmentPackages excludes them),
 *      so this override lives at the webhook seam.
 */

import {
  mapTrendyolShipmentPackage,
  type MappedOrder,
  type TrendyolShipmentPackage,
} from '@pazarsync/marketplace';

type CreatedBy = 'order-creation' | 'cancel' | 'split' | 'transfer' | string;

interface WebhookPayloadWithMeta extends TrendyolShipmentPackage {
  createdBy?: CreatedBy;
}

export function mapTrendyolWebhookPayload(
  payload: WebhookPayloadWithMeta,
  routedStatus: MappedOrder['status'],
): MappedOrder {
  const base = mapTrendyolShipmentPackage(payload);

  // Apply the route's resolved status (the route already short-circuits
  // unknown statuses before reaching this mapper).
  base.status = routedStatus;

  // Transfer override — package no longer belongs to this seller.
  if (payload.createdBy === 'transfer') {
    base.status = 'CANCELLED';
  }

  return base;
}
