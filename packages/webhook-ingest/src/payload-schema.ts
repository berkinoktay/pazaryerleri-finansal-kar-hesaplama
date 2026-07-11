/**
 * Trendyol order-webhook payload schema — minimal runtime validation.
 *
 * Extracted from the receiver route so BOTH the route (validating the inbound
 * request body) and the sync-worker consumer tick (re-parsing `rawPayload` off a
 * persisted `webhook_events` row before dispatch) validate against ONE schema.
 *
 * We assert only the fields the receiver + mapper actually consume; the full
 * `TrendyolShipmentPackage` shape stays a TS type and the extra 30+ payload
 * fields pass through unchecked (`.passthrough()`), forwarded verbatim to the
 * mapper. A malformed payload short-circuits BEFORE the intake path.
 * Contract: docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/webhook/webhook-model.md.
 *
 * supplierId optional + lines[].sellerId required: Trendyol prod webhook
 * payloads ship a root-level `supplierId`, but the stage test-order endpoint
 * omits it. Per-line `sellerId` is present in both envs (authoritative seller
 * scope).
 *
 * lineUnitPrice + lineGrossAmount + vatRate optional: the mapper already
 * tolerates their absence (`?? 0`, logged as `orders.sparse-line`), so the
 * receiver must not be stricter than the mapper it feeds. Sparseness is a
 * Trendyol STAGE test-order artifact — PROD webhooks always ship full pricing.
 * Accepting a sparse payload as an estimate-incomplete order is strictly better
 * than the previous silent 200-drop, which wrote no row and killed the webhook's
 * real-time path (intake + toast + live performance) entirely.
 *
 * IMPORTANT: a sparse order's estimate money is WRITE-ONCE at create — a later
 * sync does NOT heal it (upsert-order.ts updates only status/delivery/cargo/
 * watermark; OrderItem lines are insert-skip-if-exists). Only settlement
 * reconciliation writes the real settled values. Stage orders with an
 * uncatalogued barcode route to the cost-missing BUFFER, whose snapshot IS
 * refreshed before promotion, so they self-heal there; a sparse order for a
 * calculable (cost-known) product would freeze its zero estimate money until
 * settlement (rare — prod ships full pricing).
 *
 * sellerId + quantity stay REQUIRED: sellerId is the authoritative seller-scope
 * guard and quantity is load-bearing for a meaningful order (stage payloads
 * carry both).
 */
import { z } from 'zod';

const TrendyolWebhookLineSchema = z
  .object({
    sellerId: z.number().int().positive('LINE_SELLER_ID_REQUIRED'),
    quantity: z.number().int().positive('LINE_QUANTITY_REQUIRED'),
    lineUnitPrice: z.number().nonnegative('LINE_UNIT_PRICE_REQUIRED').optional(),
    lineGrossAmount: z.number().nonnegative('LINE_GROSS_AMOUNT_REQUIRED').optional(),
    vatRate: z.number().nonnegative('LINE_VAT_RATE_REQUIRED').optional(),
  })
  .passthrough();

export const TrendyolWebhookPayloadSchema = z
  .object({
    shipmentPackageId: z.number().int().positive('SHIPMENT_PACKAGE_ID_REQUIRED'),
    orderNumber: z.string().min(1, 'ORDER_NUMBER_REQUIRED'),
    status: z.string().min(1, 'STATUS_REQUIRED'),
    orderDate: z.number().int().positive('ORDER_DATE_REQUIRED'),
    lastModifiedDate: z.number().int().positive('LAST_MODIFIED_DATE_REQUIRED'),
    supplierId: z.number().int().positive('SUPPLIER_ID_REQUIRED').optional(),
    lines: z.array(TrendyolWebhookLineSchema).min(1, 'LINES_REQUIRED'),
  })
  .passthrough();

export type TrendyolWebhookPayload = z.infer<typeof TrendyolWebhookPayloadSchema>;
