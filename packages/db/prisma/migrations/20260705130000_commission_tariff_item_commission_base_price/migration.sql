-- "KOMİSYONA ESAS FİYAT" from the tariff Excel — the customer-seen price the
-- commission is charged on. Nullable: tariffs imported before the column was
-- read carry NULL (profit compute falls back to current_price; a re-import
-- backfills the real value).

-- AlterTable
ALTER TABLE "commission_tariff_items" ADD COLUMN "commission_base_price" DECIMAL(12,2);
