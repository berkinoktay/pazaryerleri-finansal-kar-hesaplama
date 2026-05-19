/**
 * `Order.deliveredOnTime` türetilmiş hesabı (design §3.1 + §12.1 #9).
 *
 * - agreedDeliveryDate: getShipmentPackages endpoint direkt field (T+0'da bilinir)
 * - actualDeliveryDate: packageHistories[status='Delivered'].createdAt'tan türetilir
 *   (Delivered status webhook anında sync handler set'ler)
 *
 * Sonuç PSF rate seçimi için kullanılır:
 *   - fastDelivery=true && deliveredOnTime=true → PLATFORM_SERVICE_FAST (₺6.99)
 *   - Aksi durumda → PLATFORM_SERVICE (₺10.99)
 *
 * Henüz teslim olmamış sipariş için `null` döner (PSF ESTIMATE conservative
 * ₺10.99'la yazılır; T+~5 settlement geldikten sonra correction OrderFee
 * CREDIT yazılarak ₺4.00 indirilir, design §4.2).
 */

interface OrderForDeliveryTiming {
  agreedDeliveryDate: Date | null;
  actualDeliveryDate: Date | null;
}

export function inferDeliveredOnTime(order: OrderForDeliveryTiming): boolean | null {
  if (order.actualDeliveryDate === null) return null; // henüz teslim olmadı
  if (order.agreedDeliveryDate === null) return null; // verisiz
  return order.actualDeliveryDate.getTime() <= order.agreedDeliveryDate.getTime();
}
