ALTER TABLE "order_fees"
  DROP COLUMN "amount_net", DROP COLUMN "vat_amount",
  ADD COLUMN "amount_gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;
