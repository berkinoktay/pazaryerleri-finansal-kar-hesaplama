-- Phase 5 of the profit-engine rebuild: live_performance_buffer.mapped_order holds the
-- mapped order as JSONB. Rows buffered before 20261111121515 (micro -> isExportSale)
-- still carry the export flag under the legacy "micro" key. Move it once here so every
-- reader sees a single shape and the order writer needs no legacy-key fallback. A row
-- that already carries isExportSale is left alone.
UPDATE live_performance_buffer
SET mapped_order = (mapped_order - 'micro') || jsonb_build_object('isExportSale', mapped_order -> 'micro')
WHERE mapped_order ? 'micro'
  AND NOT (mapped_order ? 'isExportSale');
