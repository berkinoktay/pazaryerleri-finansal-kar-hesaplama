/**
 * Placeholder message catalog for the design system scaffolding.
 *
 * Real feature text will live in per-locale JSON files loaded at request
 * time by a future i18n config. Keys here exist only to let showcase and
 * landing code demonstrate `useTranslations` without crashing.
 */

export const DEFAULT_LOCALE = 'tr' as const;
export const DEFAULT_TIME_ZONE = 'Europe/Istanbul' as const;

export const DEFAULT_MESSAGES = {
  common: {
    appName: 'PazarSync',
    lastSynced: 'Son senkronizasyon',
    gmtOffset: 'GMT+3',
    loading: 'Yükleniyor',
    empty: 'Veri yok',
    retry: 'Tekrar dene',
    actions: {
      save: 'Kaydet',
      cancel: 'Vazgeç',
      import: 'İçe aktar',
      export: 'Dışa aktar',
      filter: 'Filtre',
      search: 'Ara',
      syncNow: 'Şimdi senkronize et',
    },
  },
  dashboard: {
    title: 'Gösterge paneli',
    kpi: {
      revenue: 'Ciro',
      netProfit: 'Net kar',
      orders: 'Sipariş',
      returns: 'İade',
    },
  },
  orders: {
    title: 'Siparişler',
    status: {
      pending: 'Bekleyen',
      shipped: 'Kargoda',
      delivered: 'Teslim edildi',
      cancelled: 'İptal',
      returned: 'İade',
    },
  },
  nav: {
    dashboard: 'Panel',
    orders: 'Siparişler',
    products: 'Ürünler',
    profitability: 'Karlılık',
    reconciliation: 'Mutabakat',
    expenses: 'Giderler',
    settings: 'Ayarlar',
  },
};
