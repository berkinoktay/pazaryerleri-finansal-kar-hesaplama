-- Data only: a custom price of 0 was never a real price. The selection route now
-- refuses it (422 INVALID_CUSTOM_PRICE), but a value stored before could still reach
-- the export as 0.00 and would make every later save of its tariff fail. It becomes
-- NULL (no custom price): the item falls back to its selected band, or the export
-- refuses it (409 SELECTION_PRICE_UNKNOWN) when that band has no price. updated_at is
-- left alone: the seller did not change anything.
UPDATE "commission_tariff_items" SET "custom_price" = NULL WHERE "custom_price" = 0;
