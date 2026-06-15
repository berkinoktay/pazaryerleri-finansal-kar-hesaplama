// Real Trendyol prod order payloads — the empirical penny-lock for the GROSS
// mapper (spec §4). Captured via scripts/dump-raw-lines.ts (2026-06-16) and
// verified against the panel + a competitor's profit object to the kuruş.
// These pin the mapper to Trendyol's package totals; if the mapper drifts even
// a kuruş from the expected values asserted in orders.test.ts, the mapper is
// wrong — never adjust these fixtures to match a broken mapper.

import type { TrendyolShipmentPackage } from '../../src/trendyol/types';

// 11313045474 (tek ürün, 3 adet): paket 855 / 48,01 / 806,99;
// discountDetails [16,01 ; 16 ; 16] = 48,01 (birim×adet = 48,00 → sapar).
export const PAYLOAD_11313045474: TrendyolShipmentPackage = {
  orderNumber: 'ORD-11313045474',
  shipmentPackageId: 11313045474,
  status: 'Delivered',
  orderDate: Date.UTC(2026, 5, 10, 10, 0),
  lastModifiedDate: Date.UTC(2026, 5, 15, 14, 30),
  packageGrossAmount: 855,
  packageSellerDiscount: 48.01,
  packageTotalPrice: 806.99,
  fastDelivery: false,
  micro: false,
  lines: [
    {
      lineId: 1,
      barcode: 'TB100X150A',
      quantity: 3,
      lineUnitPrice: 269,
      lineGrossAmount: 285,
      lineSellerDiscount: 16,
      vatRate: 10,
      commission: 9.6,
      discountDetails: [
        { lineItemPrice: 268.99, lineItemSellerDiscount: 16.01 },
        { lineItemPrice: 269, lineItemSellerDiscount: 16 },
        { lineItemPrice: 269, lineItemSellerDiscount: 16 },
      ],
    },
  ],
};

// 11323825496 (3 ürün, hepsi qty1, farklı komisyon 14,8 / 19 / 15,2):
// paket 446 / 22,3 / 423,7. Her satır discountDetails 1-elemanlı, Σ = paket.
export const PAYLOAD_11323825496: TrendyolShipmentPackage = {
  orderNumber: 'ORD-11323825496',
  shipmentPackageId: 11323825496,
  status: 'Delivered',
  orderDate: Date.UTC(2026, 5, 11, 12, 0),
  lastModifiedDate: Date.UTC(2026, 5, 16, 10, 0),
  packageGrossAmount: 446,
  packageSellerDiscount: 22.3,
  packageTotalPrice: 423.7,
  fastDelivery: false,
  micro: false,
  lines: [
    {
      lineId: 101,
      barcode: 'TB50X75A',
      quantity: 1,
      lineUnitPrice: 104.5,
      lineGrossAmount: 110,
      lineSellerDiscount: 5.5,
      vatRate: 10,
      commission: 14.8,
      discountDetails: [{ lineItemPrice: 104.5, lineItemSellerDiscount: 5.5 }],
    },
    {
      lineId: 102,
      barcode: 'ADB0000000002',
      quantity: 1,
      lineUnitPrice: 174.8,
      lineGrossAmount: 184,
      lineSellerDiscount: 9.2,
      vatRate: 10,
      commission: 19,
      discountDetails: [{ lineItemPrice: 174.8, lineItemSellerDiscount: 9.2 }],
    },
    {
      lineId: 103,
      barcode: 'TB60X90A',
      quantity: 1,
      lineUnitPrice: 144.4,
      lineGrossAmount: 152,
      lineSellerDiscount: 7.6,
      vatRate: 10,
      commission: 15.2,
      discountDetails: [{ lineItemPrice: 144.4, lineItemSellerDiscount: 7.6 }],
    },
  ],
};
