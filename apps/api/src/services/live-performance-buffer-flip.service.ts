import type { Prisma } from '@pazarsync/db';
import {
  buildCalcCheckLines,
  resolveOrderCalculability,
  type OrderLineForCalcCheck,
} from '@pazarsync/profit';
import { getBusinessDate, getBusinessDateAnchor } from '@pazarsync/utils';

const MALFORMED_ENTRY_LOG =
  '[buffer-flip] skipped a buffer entry with malformed mapped order lines';

/**
 * The line barcodes of a buffered order's `mapped_order` JSON (a `MappedOrder`), or
 * null when the payload does not have that shape. The flip reads nothing else from
 * it. A malformed entry can never become calculable (a line without a barcode never
 * resolves to a variant), so the caller skips it instead of failing the seller's cost
 * or desi write; the day-end flush handles it through its own failure path.
 */
function readLineBarcodes(mappedOrder: unknown): string[] | null {
  if (typeof mappedOrder !== 'object' || mappedOrder === null || !('lines' in mappedOrder)) {
    return null;
  }
  const lines: unknown = mappedOrder.lines;
  if (!Array.isArray(lines)) return null;
  const barcodes: string[] = [];
  for (const line of lines) {
    const item: unknown = line;
    if (typeof item !== 'object' || item === null || !('barcode' in item)) return null;
    const { barcode } = item;
    if (typeof barcode !== 'string') return null;
    barcodes.push(barcode);
  }
  return barcodes;
}

/**
 * Resolve every distinct barcode once with buildCalcCheckLines (one variant query,
 * scoped to the organization and store) and key the result by barcode. Its output
 * is one line per input line, in input order, so each distinct barcode maps to the
 * line it resolved to, an unresolved barcode included (variantId null).
 */
async function resolveCalcLinesByBarcode(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; storeId: string; barcodes: readonly string[] },
): Promise<Map<string, OrderLineForCalcCheck>> {
  const distinct = [...new Set(args.barcodes)];
  const lines = await buildCalcCheckLines(tx, {
    organizationId: args.organizationId,
    storeId: args.storeId,
    lines: distinct.map((barcode) => ({ barcode })),
  });
  return new Map(lines.map((line) => [line.barcode, line]));
}

/**
 * One order's calc-check lines, in its own line order, from the shared lookup; null
 * when a barcode is missing from it (never the case, since the lookup was built
 * from every candidate's barcodes), so such an order is simply not flipped.
 */
function linesForOrder(
  lineBarcodes: readonly string[],
  lineByBarcode: ReadonlyMap<string, OrderLineForCalcCheck>,
): OrderLineForCalcCheck[] | null {
  const lines: OrderLineForCalcCheck[] = [];
  for (const barcode of lineBarcodes) {
    const line = lineByBarcode.get(barcode);
    if (line === undefined) return null;
    lines.push(line);
  }
  return lines;
}

/**
 * Live Performance side-effect: flip PENDING buffer entries to PROMOTING when a
 * write to a variant (a cost attach, or a desi entered by the seller) makes their
 * order FULLY calculable. Runs inside the caller's transaction so the flip commits
 * atomically with the write.
 *
 * Only an entry whose EVERY line barcode now resolves to a variant with a cost and,
 * when it is not digital, a desi is flipped (resolveOrderCalculability, the same
 * gate the webhook receiver uses). A multi-line order with one line still missing
 * its cost or desi stays PENDING, so a partially calculable order is never promoted
 * into `orders`. Forward-only: never reverts PROMOTING to PENDING. The promote
 * worker then writes the PROMOTING entries to `orders` on its next tick.
 *
 * Tenant scope: the variants resolve by `{ id IN variantIds, organizationId,
 * storeId }`, and only that store's buffer is scanned and written, so a variant id
 * of another store or organization never triggers anything (SECURITY.md).
 *
 * Cost-window scope (Berkin 2026-11-03): only a buffer row whose order day has NOT
 * ended yet (same-day or later) is flipped. A past-day row's window is already
 * closed, so the day-end flush, not a late cost or desi entry, graduates it under
 * the cost-window and desi rules.
 *
 * Concurrency: a desi entry and a cost attach that complete the same order at the
 * same moment each see only their own write, so neither may flip it. The entry is
 * not lost: it stays PENDING and graduates when the order is delivered again or at
 * the day-end flush (which promotes it, since its cost and desi are then present).
 *
 * Returns the number of entries flipped; the cost attach returns it to the UI in
 * `bufferEntriesPromoted`.
 */
export async function flipBufferForVariants(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; storeId: string; variantIds: readonly string[] },
): Promise<number> {
  const { organizationId, storeId } = args;
  if (args.variantIds.length === 0) return 0;

  // Business-day anchor for the same-day guard on the flip update below. order_date
  // is a DATE anchor, so this reuses the exact DATE comparison the day-end flush uses
  // (orderDate < todayAnchor == past day) rather than a raw-SQL date cast.
  const todayAnchor = getBusinessDateAnchor(new Date());

  const variants = await tx.productVariant.findMany({
    where: { id: { in: [...args.variantIds] }, organizationId, storeId },
    select: { barcode: true },
  });
  if (variants.length === 0) return 0;
  const barcodes = variants.map((variant) => variant.barcode);

  // Narrow to today's PENDING entries in this store whose mapped_order has a line with
  // one of the just-written barcodes: the only orders that could have just become
  // calculable (a past-day entry is never flipped, see the update below). A payload
  // whose lines are not an array is read as no lines instead of raising.
  const today = getBusinessDate();
  const candidates = await tx.$queryRaw<Array<{ id: string; mapped_order: unknown }>>`
    SELECT id, mapped_order
    FROM live_performance_buffer
    WHERE store_id = ${storeId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND status = 'PENDING'::buffer_entry_status
      AND order_date >= ${today}::date
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(mapped_order->'lines') = 'array'
            THEN mapped_order->'lines' ELSE '[]'::jsonb END
        ) AS line
        WHERE line->>'barcode' = ANY(${barcodes}::text[])
      )
  `;

  const readable: Array<{ id: string; lineBarcodes: string[] }> = [];
  for (const row of candidates) {
    const lineBarcodes = readLineBarcodes(row.mapped_order);
    if (lineBarcodes === null) {
      console.warn(MALFORMED_ENTRY_LOG, { organizationId, storeId, entryId: row.id });
      continue;
    }
    readable.push({ id: row.id, lineBarcodes });
  }
  if (readable.length === 0) return 0;

  // ONE variant query for every candidate's lines: each distinct barcode is
  // resolved once (same org + store scope), then every order's lines are rebuilt
  // in its own line order, repeated barcodes included.
  const lineByBarcode = await resolveCalcLinesByBarcode(tx, {
    organizationId,
    storeId,
    barcodes: readable.flatMap((entry) => entry.lineBarcodes),
  });

  const promotableIds: string[] = [];
  for (const entry of readable) {
    const calcLines = linesForOrder(entry.lineBarcodes, lineByBarcode);
    if (calcLines !== null && resolveOrderCalculability(calcLines).kind === 'calculable') {
      promotableIds.push(entry.id);
    }
  }
  if (promotableIds.length === 0) return 0;

  const result = await tx.livePerformanceBuffer.updateMany({
    // Same-day guard (cost-window rule): flip only rows whose order day has not
    // ended. A past-day row stays PENDING for the day-end flush to graduate (and
    // exclude unless its cost was timely and its desi present); a late entry must
    // not promote it. organizationId and storeId are defense in depth: the
    // candidate ids already come from a tenant-filtered query, but every buffer
    // write pins the tenant (CLAUDE.md).
    where: {
      id: { in: promotableIds },
      organizationId,
      storeId,
      status: 'PENDING',
      orderDate: { gte: todayAnchor },
    },
    data: { status: 'PROMOTING' },
  });
  return result.count;
}
