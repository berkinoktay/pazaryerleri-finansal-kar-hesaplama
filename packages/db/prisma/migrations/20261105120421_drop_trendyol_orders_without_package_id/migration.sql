-- Trendyol reports shipmentPackageId = 0 for a package it has not created yet
-- (an Awaiting order before the payment check). Intake keyed every such package
-- onto platform_order_id '0', so a row with that id holds whichever Awaiting
-- order was written last. Intake now skips these packages; remove the rows
-- written before the fix. Profit rows follow the order through ON DELETE CASCADE.
DELETE FROM live_performance_buffer b
 USING stores s
 WHERE b.store_id = s.id
   AND s.platform = 'TRENDYOL'
   AND b.platform_order_id = '0';

DELETE FROM orders o
 USING stores s
 WHERE o.store_id = s.id
   AND s.platform = 'TRENDYOL'
   AND o.platform_order_id = '0';
