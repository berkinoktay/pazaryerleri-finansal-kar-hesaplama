-- estimated_net_profit write-once GEVŞETME (2026-06-13).
-- Kargo bedeli fatura çıkana kadar tahmindir ve rafine olur (T+0 ürün-desi →
-- kargoya verilince cargoDeci). "Tahmini kâr" (estimated_net_profit) bu yüzden
-- güncellenebilir olmalı. Maliyet-dondurma garantisi order_items snapshot
-- immutability'sinden gelir (dokunulmaz); EXCLUDED sipariş donması
-- reject_profit_freeze_breach'te korunur. Mirror: supabase/sql/triggers.sql.
--
-- KABUL EDİLEN ZAYIFLAMA (review M1): "hesaplanmış sipariş kâr-dışına çekilemez"
-- garantisi artık yalnız OLD.estimated_net_profit NOT NULL iken tutar. Teorik
-- 2-UPDATE açığı (estimate'i NULL'la → exclude et) app kodundan ULAŞILMAZ:
-- estimate write-many olduğundan saf write-once geri konamaz; tek NULL'layan
-- dedup-repair (rn>1) güvenli, exclusion yalnız CREATE'te damgalanır.
DROP TRIGGER IF EXISTS orders_estimated_net_profit_write_once ON orders;
DROP FUNCTION IF EXISTS public.reject_estimated_net_profit_update();
