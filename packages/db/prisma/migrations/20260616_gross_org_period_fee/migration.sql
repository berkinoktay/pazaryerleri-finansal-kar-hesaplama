-- OrgPeriodFee GROSS convention (2026-06-16, Bölüm E Task 20)
-- amountNet + vatAmount → amountGross + vatRate (PSF vatRate=20; Stoppage vatRate=0)
-- Net türetilir: amountGross × 100 / (100 + vatRate)
ALTER TABLE "org_period_fees"
  DROP COLUMN "amount_net",
  DROP COLUMN "vat_amount",
  ADD COLUMN "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0;
