-- Issue #291: returned-item cost reversal fee type. When a settlement
-- Return confirms a unit came back to stock, its cost snapshot is
-- credited back via a COST_RETURN OrderFee (money-trail proof
-- 2026-06-10: Trendyol nets commission AND the unit never consumed
-- its cost — competitor parity confirmed the product decision).
ALTER TYPE "OrderFeeType" ADD VALUE 'COST_RETURN';
