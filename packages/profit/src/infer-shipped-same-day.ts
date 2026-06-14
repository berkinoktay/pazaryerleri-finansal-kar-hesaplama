/**
 * SameDayShipping ("Bugün Kargoda") "satıcı sözünü tuttu" kriteri (2026-06-14).
 *
 * Resmi Trendyol PSF kuralı: 6.99 (vs 10.99) Platform Hizmet Bedeli indirimi
 * yalnız `fastDeliveryType === 'SameDayShipping'` gönderilerinde, paket aynı gün
 * **taşıma durumuna geçtiğinde** (Shipped) hak edilir. Kriter SEVK bazlı — TESLİM
 * değil (kargo satıcının kontrolünde değil). "taşıma durumuna geçiş" =
 * `actualShipDate` = packageHistories[Shipped].createdDate.
 *
 * Cutoff (ürün `deliveryDailyCutOffHour`) Trendyol'un SİPARİŞ-uygunluk kapısıdır
 * (etiketi uygunluğa göre Trendyol verir) → biz tekrar kontrol ETMEYİZ; sadece
 * etikete (fastDeliveryType) + aynı-gün sevke bakarız.
 *
 * Karşılaştırma İSTANBUL takvim gününde (orderDate true-instant, actualShipDate
 * true-UTC; getBusinessDate ikisini de İstanbul gününe çevirir).
 *
 * Dönüş:
 *   - null  → henüz sevk edilmedi (actualShipDate null). Estimate optimistik davranır.
 *   - true  → aynı gün sevk (indirim hak edildi).
 *   - false → farklı gün sevk (indirim hak EDİLMEDİ → standart 10.99).
 */

import { getBusinessDate } from '@pazarsync/utils';

export interface OrderForShipTiming {
  /** Siparişin gerçek-anı (Trendyol GMT+3 stamp'ından normalize edilmiş). */
  orderDate: Date;
  /** Shipped event'inin gerçek-anı (packageHistories[Shipped].createdDate); sevk yoksa null. */
  actualShipDate: Date | null;
}

export function inferShippedSameDay(order: OrderForShipTiming): boolean | null {
  if (order.actualShipDate === null) return null;
  return getBusinessDate(order.actualShipDate) === getBusinessDate(order.orderDate);
}
