import Decimal from 'decimal.js';

/**
 * Shape of a single activity-feed entry. Originally lived alongside the
 * ActivityRail component; that rail was removed when the shell collapsed
 * from four to three columns. The mock data below is kept and will be
 * reused by the upcoming /notifications page.
 */
export interface ActivityEntry {
  id: string;
  icon: 'success' | 'warning' | 'info';
  title: string;
  timestamp: string;
  source?: string;
}

export const MOCK_ACTIVITY: ActivityEntry[] = [
  {
    id: 'a1',
    icon: 'success',
    title: '142 sipariş senkronize edildi',
    timestamp: '2 dk önce',
    source: 'Trendyol',
  },
  {
    id: 'a2',
    icon: 'warning',
    title: '3 hakediş satırı eksik veri',
    timestamp: '14 dk önce',
    source: 'Trendyol',
  },
  {
    id: 'a3',
    icon: 'info',
    title: 'Fiyat eşleştirme tamamlandı',
    timestamp: '1 sa önce',
    source: 'Sistem',
  },
  {
    id: 'a4',
    icon: 'success',
    title: 'Kargo tarife yeniden hesaplandı',
    timestamp: '3 sa önce',
    source: 'Sistem',
  },
];

export interface MockOrder {
  id: string;
  orderNumber: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
  status: 'pending' | 'shipped' | 'delivered' | 'returned';
  customer: string;
  orderDate: string;
  grossAmount: Decimal;
  commissionAmount: Decimal;
  shippingCost: Decimal;
  netProfit: Decimal;
}

const MOCK_CUSTOMERS = [
  'Ayşe Yılmaz',
  'Mehmet Demir',
  'Fatma Şahin',
  'Ali Çelik',
  'Zeynep Aydın',
  'Mustafa Koç',
  'Elif Arslan',
  'Emre Doğan',
  'Selin Kaya',
  'Burak Özdemir',
];

export function buildMockOrders(count: number): MockOrder[] {
  return Array.from({ length: count }, (_, i) => {
    const gross = new Decimal(50 + ((i * 37) % 1450)).add(0.9);
    const commission = gross.mul(0.2364);
    const shipping = new Decimal(i % 5 === 0 ? 42.99 : 29.99);
    const netProfit = gross.sub(commission).sub(shipping);
    const statuses: MockOrder['status'][] = ['pending', 'shipped', 'delivered', 'returned'];
    const platforms: MockOrder['platform'][] = ['TRENDYOL', 'HEPSIBURADA'];
    return {
      id: `order-${i + 1}`,
      orderNumber: `TY-${2948000 + i}`,
      platform: platforms[i % 2]!,
      status: statuses[i % 4]!,
      customer: MOCK_CUSTOMERS[i % MOCK_CUSTOMERS.length]!,
      orderDate: new Date(2026, 3, 1 + (i % 28)).toISOString(),
      grossAmount: gross,
      commissionAmount: commission,
      shippingCost: shipping,
      netProfit,
    };
  });
}
