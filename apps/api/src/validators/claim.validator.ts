import { z } from '@hono/zod-openapi';

import { TableMetaSchema, TablePaginationQuerySchema } from '../openapi';

// ─── List query ────────────────────────────────────────────────────────────

export const listClaimsQuerySchema = TablePaginationQuerySchema.extend({
  status: z.enum(['open', 'resolved']).optional().openapi({
    description: 'Tab filter — open (resolved=false) or resolved. Absent = all claims.',
    example: 'open',
  }),
  from: z.coerce.date().optional().openapi({ description: 'claimDate >= (ISO date).' }),
  to: z.coerce.date().optional().openapi({ description: 'claimDate <= (ISO date).' }),
  q: z.string().trim().min(1).max(120).optional().openapi({
    description: 'Substring search over platformOrderNumber and trendyolClaimId.',
  }),
}).openapi('ListClaimsQuery');
export type ListClaimsQuery = z.infer<typeof listClaimsQuerySchema>;

// ─── Derived wire shapes ─────────────────────────────────────────────────

const DerivedClaimStatusSchema = z
  .enum(['OPEN', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'MIXED'])
  .openapi({
    description:
      'OPEN while unresolved; on resolution, derived from item statuses — uniform Accepted/' +
      'Rejected/Cancelled map 1:1, anything heterogeneous is MIXED.',
  });

const ClaimScopeSchema = z.enum(['FULL', 'PARTIAL']).openapi({
  description: 'FULL when the claim covers every ordered unit, PARTIAL otherwise.',
});

const ClaimProductSummarySchema = z
  .object({
    firstName: z.string().nullable().openapi({
      description: 'First product title in the claim; null when items are not linked to a line.',
    }),
    units: z.number().int().nonnegative(),
    otherCount: z.number().int().nonnegative().openapi({
      description: 'Count of OTHER distinct products beyond the first — "+N" in the UI.',
    }),
  })
  .openapi('ClaimProductSummary');

const ClaimReasonSummarySchema = z
  .object({
    first: z.string(),
    otherCount: z.number().int().nonnegative(),
  })
  .openapi('ClaimReasonSummary');

export const ClaimListItemSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    platformOrderNumber: z.string().nullable(),
    trendyolClaimId: z.string(),
    claimDate: z.string().datetime(),
    resolved: z.boolean(),
    derivedStatus: DerivedClaimStatusSchema,
    scope: ClaimScopeSchema,
    itemCount: z.number().int().nonnegative().openapi({
      description: 'Per-unit claim item count (a 3-unit return = 3).',
    }),
    productSummary: ClaimProductSummarySchema,
    reasonSummary: ClaimReasonSummarySchema,
    cargoProviderName: z.string().nullable(),
    cargoTrackingNumber: z.string().nullable().openapi({
      description: 'Cargo tracking number as string — original DB column is BigInt.',
    }),
  })
  .openapi('ClaimListItem');

export const ListClaimsResponseSchema = z
  .object({
    data: z.array(ClaimListItemSchema),
    pagination: TableMetaSchema,
    counts: z
      .object({
        all: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
      })
      .openapi({
        description:
          'Status-tab totals. Honor sibling filters (q, from/to) but ignore status so every ' +
          'tab shows its true size.',
      }),
  })
  .openapi('ListClaimsResponse');

// ─── Summary ─────────────────────────────────────────────────────────────

export const claimsSummaryQuerySchema = z
  .object({
    from: z.coerce.date().optional().openapi({
      description: 'Period start — defaults to 30 days before `to` when absent.',
    }),
    to: z.coerce.date().optional().openapi({ description: 'Period end — defaults to now.' }),
  })
  .openapi('ClaimsSummaryQuery');
export type ClaimsSummaryQuery = z.infer<typeof claimsSummaryQuerySchema>;

export const ClaimsSummaryResponseSchema = z
  .object({
    openCount: z.number().int().nonnegative().openapi({
      description: 'Unresolved claims RIGHT NOW — date filters do not apply (current workload).',
    }),
    resolvedInPeriod: z.number().int().nonnegative().openapi({
      description: 'Claims with claimDate in the period that are resolved.',
    }),
    refundDeductionGross: z.string().openapi({
      description: 'Sum of REFUND_DEDUCTION (net+VAT) captured in the period. Decimal string.',
      example: '785.50',
    }),
    commissionRefundGross: z.string(),
    costReturnGross: z.string(),
    netImpactGross: z.string().openapi({
      description: '−refundDeduction + commissionRefund + costReturn — usually negative.',
      example: '-471.30',
    }),
  })
  .openapi('ClaimsSummaryResponse');
