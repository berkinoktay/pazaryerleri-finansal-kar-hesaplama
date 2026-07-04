-- One commission tariff per week per store. The tariff's week window is
-- min(period.startsAt) … max(period.endsAt), stored as full datetime because
-- consecutive weeks touch at a 1-minute gap (…07.59 → …08.00) so DATE alone is
-- not unique. Postgres treats NULLs as DISTINCT, so rows whose date labels were
-- unparseable (week_starts_at NULL) are not blocked. The Advantage upload picks a
-- commission tariff BY this week. See docs/plans/2026-07-03-advantage-labels-design.md.

-- AlterTable
ALTER TABLE "commission_tariffs" ADD COLUMN "week_starts_at" TIMESTAMP(3);
ALTER TABLE "commission_tariffs" ADD COLUMN "week_ends_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "commission_tariffs_store_id_week_starts_at_key" ON "commission_tariffs"("store_id", "week_starts_at");
