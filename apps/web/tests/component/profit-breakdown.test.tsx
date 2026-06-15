import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { formatCurrency } from '@pazarsync/utils';

import { ProfitBreakdownCard } from '@/components/patterns/profit-breakdown';

const messages = {
  profitBreakdown: {
    title: 'Kâr dökümü',
    unavailable: 'Bu sipariş için kâr hesaplanmadı.',
    sale: 'Satış',
    listPrice: 'Liste fiyatı',
    sellerDiscount: 'Satıcı indirimi',
    netSale: 'Net satış',
    cost: 'Ürün maliyeti',
    commission: 'Komisyon',
    shipping: 'Kargo',
    platformService: 'Platform hizmet bedeli',
    stoppage: 'E-ticaret stopajı',
    netVat: 'Net KDV',
    netVatResult: 'Net KDV',
    saleVat: 'Satış KDV',
    costVat: 'Ürün maliyeti KDV',
    commissionVat: 'Komisyon KDV',
    shippingVat: 'Kargo KDV',
    platformServiceVat: 'Platform hizmet bedeli KDV',
    estimatedProfit: 'Tahmini kâr',
    settledProfit: 'Fiili kâr',
  },
};

// Gerçek stage siparişi 569592424 değerleri (backend-servisli). İndirimsiz.
const BREAKDOWN = {
  listGross: '3300.00',
  sellerDiscountGross: '0.00',
  saleGross: '3300.00',
  saleVat: '550.00',
  costGross: '1440.00',
  costVat: '240.00',
  commissionGross: '660.00',
  commissionVat: '110.00',
  shippingGross: '135.32',
  shippingVat: '22.55',
  platformServiceGross: '13.19',
  platformServiceVat: '2.20',
  stoppageNet: '27.50',
  netVat: '175.25',
  netProfit: '848.74',
};

function renderCard(breakdown: typeof BREAKDOWN | null): void {
  render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ProfitBreakdownCard breakdown={breakdown} />
    </NextIntlClientProvider>,
  );
}

describe('ProfitBreakdownCard', () => {
  it('renders the waterfall with backend-served gross terms + profit', () => {
    renderCard(BREAKDOWN);

    expect(screen.getByText('Kâr dökümü')).toBeInTheDocument();
    // Düşülen kalem etiketleri + son kâr.
    for (const label of [
      'Satış',
      'Ürün maliyeti',
      'Komisyon',
      'Kargo',
      'Platform hizmet bedeli',
      'E-ticaret stopajı',
      'Tahmini kâr',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Değerler backend'den; bileşen yalnız formatlar.
    expect(screen.getByText(formatCurrency('3300.00'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('848.74'))).toBeInTheDocument();
    // İndirimsiz → tek "Satış" satırı; Liste/İndirim alt-kırılımı YOK.
    expect(screen.queryByText('Liste fiyatı')).not.toBeInTheDocument();
  });

  it('shows the seller-discount transparency (list → discount → net) when there is a discount', () => {
    renderCard({ ...BREAKDOWN, listGross: '3500.00', sellerDiscountGross: '200.00' });
    expect(screen.getByText('Liste fiyatı')).toBeInTheDocument();
    expect(screen.getByText('Satıcı indirimi')).toBeInTheDocument();
    expect(screen.getByText('Net satış')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('3500.00'))).toBeInTheDocument(); // liste
    expect(screen.getByText(formatCurrency('200.00'))).toBeInTheDocument(); // indirim
    // İndirim varken tek "Satış" satırı YOK (Net satış'a dönüştü).
    expect(screen.queryByText('Satış')).not.toBeInTheDocument();
  });

  it('expands the Net KDV breakdown on click (collapsed by default)', async () => {
    const user = userEvent.setup();
    renderCard(BREAKDOWN);

    // Kapalıyken KDV kırılım satırları DOM'da değil (Radix unmount).
    expect(screen.queryByText('Satış KDV')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Net KDV/ }));

    expect(screen.getByText('Satış KDV')).toBeInTheDocument();
    expect(screen.getByText('Komisyon KDV')).toBeInTheDocument();
    expect(screen.getByText('Platform hizmet bedeli KDV')).toBeInTheDocument();
  });

  it('renders a NEGATIVE net VAT without a double minus (seller-favourable)', () => {
    // Net KDV negatif olabilir (input KDV > output) — migration bunu açıkça izin verir.
    // SignedAmount işareti string'den türetir: "−" + Intl "-₺" çift-eksisi OLMAMALI;
    // negatif değer satıcı lehine → "+" okunur.
    renderCard({ ...BREAKDOWN, netVat: '-12.50' });
    // Magnitude formatlanmış (işaret soyuldu) görünür.
    expect(screen.getByText(formatCurrency('12.50'))).toBeInTheDocument();
    // Çift-eksi / Intl'in kendi eksili biçimi DOM'da olmamalı.
    expect(screen.queryByText(formatCurrency('-12.50'))).not.toBeInTheDocument();
  });

  it('shows the unavailable message when there is no breakdown', () => {
    renderCard(null);
    expect(screen.getByText('Bu sipariş için kâr hesaplanmadı.')).toBeInTheDocument();
    expect(screen.queryByText('Kâr dökümü')).toBeInTheDocument(); // başlık sabit kalır
    expect(screen.queryByText('Satış')).not.toBeInTheDocument();
  });
});
