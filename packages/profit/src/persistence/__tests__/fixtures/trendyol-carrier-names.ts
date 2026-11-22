// Real Trendyol carrier names, as stored in the dev database's shipping_carriers
// (display_name + order_cargo_names) and as seen on real orders of the two dev stores
// (live store and stage store, 2026-11-22). The carrier-name matching test asserts that
// every one of these is recognised and that no two carriers share a normalised key.

export interface CarrierNameFixture {
  code: string;
  displayName: string;
  orderCargoNames: readonly string[];
}

export const TRENDYOL_CARRIER_NAMES: readonly CarrierNameFixture[] = [
  { code: 'YKMP', displayName: 'Yurtiçi Kargo', orderCargoNames: ['Yurtiçi Kargo Marketplace'] },
  { code: 'ARASMP', displayName: 'Aras Kargo', orderCargoNames: ['Aras Kargo Marketplace'] },
  { code: 'SURATMP', displayName: 'Sürat Kargo', orderCargoNames: ['Sürat Kargo Marketplace'] },
  {
    code: 'DHLECOMMP',
    displayName: 'DHL eCommerce',
    orderCargoNames: ['DHL eCommerce Marketplace'],
  },
  {
    code: 'TEXMP',
    displayName: 'Trendyol Express',
    orderCargoNames: ['Trendyol Express Marketplace'],
  },
  { code: 'PTTMP', displayName: 'PTT Kargo', orderCargoNames: ['PTT Kargo Marketplace'] },
  { code: 'SENDEOMP', displayName: 'Kolay Gelsin', orderCargoNames: ['Kolay Gelsin Marketplace'] },
  { code: 'HOROZMP', displayName: 'Horoz Lojistik', orderCargoNames: ['Horoz Kargo Marketplace'] },
  { code: 'CEVAMP', displayName: 'CEVA', orderCargoNames: ['CEVA Marketplace'] },
  {
    code: 'CEVATEDARIK',
    displayName: 'CEVA Tedarik',
    orderCargoNames: ['Ceva Tedarik Marketplace'],
  },
];

/** Every cargo name seen on a real dev order, with the carrier it must resolve to. */
export const OBSERVED_ORDER_CARGO_NAMES: ReadonlyArray<{ name: string; code: string }> = [
  { name: 'Trendyol Express Marketplace', code: 'TEXMP' },
  { name: 'DHL eCommerce Marketplace', code: 'DHLECOMMP' },
  { name: 'PTT Kargo Marketplace', code: 'PTTMP' },
  { name: 'Yurtiçi Kargo Marketplace', code: 'YKMP' },
  { name: 'Kolay Gelsin Marketplace', code: 'SENDEOMP' },
  { name: 'Aras Kargo Marketplace', code: 'ARASMP' },
  { name: 'CEVA Marketplace', code: 'CEVAMP' },
  { name: 'Sürat Kargo Marketplace', code: 'SURATMP' },
  { name: 'Horoz Kargo Marketplace', code: 'HOROZMP' },
];

/** Spelling variants that must resolve like their canonical name. */
export const CARGO_NAME_VARIANTS: ReadonlyArray<{ name: string; code: string }> = [
  { name: 'YURTİÇİ KARGO MARKETPLACE', code: 'YKMP' },
  { name: 'yurtiçi kargo marketplace', code: 'YKMP' },
  { name: 'YURTIÇI KARGO MARKETPLACE', code: 'YKMP' },
  { name: '  Yurtiçi   Kargo  Marketplace ', code: 'YKMP' },
  { name: 'SÜRAT KARGO MARKETPLACE', code: 'SURATMP' },
  { name: 'DHL-eCommerce Marketplace', code: 'DHLECOMMP' },
  { name: 'Trendyol Express Marketplace.', code: 'TEXMP' },
  { name: 'PTT  KARGO  MARKETPLACE', code: 'PTTMP' },
];

/** Names no Trendyol carrier owns; they must stay unrecognised. */
export const UNRECOGNISED_CARGO_NAMES: readonly string[] = ['Alternative Delivery', '***', ''];
