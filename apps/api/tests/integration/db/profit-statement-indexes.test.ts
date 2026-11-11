import { prisma } from '@pazarsync/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureDbReachable } from '../../helpers/db';

/**
 * Phase 3D, Task 2 — order_profit_statements partial index (plan decision 5).
 *
 * The idle stale sweep's NOT EXISTS probe (every order without a current
 * BEST_KNOWN statement) must answer from an index alone. Prisma 7 cannot
 * express a partial (WHERE-clause) index, so it lives in
 * supabase/sql/check-constraints.sql and is asserted here against pg_indexes.
 */
describe('order_profit_statements indexes (phase 3D)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('indexes best-known statements by order and engine version', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'order_profit_statements'
        AND indexname = 'order_profit_statements_best_known_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('(order_id, engine_version)');
    expect(rows[0]?.indexdef).toContain("WHERE (view = 'BEST_KNOWN'");
  });
});
