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
    shippingTotal: 'Toplam kargo bedeli',
    outboundShipping: 'Gidiş kargosu',
    returnShipping: 'İade kargosu',
    platformService: 'Platform hizmet bedeli',
    stoppage: 'Stopaj',
    promotions: 'Promosyonlar',
    netVat: 'Net KDV',
    netVatResult: 'Net KDV',
    saleVat: 'Satış KDV',
    costVat: 'Ürün maliyeti KDV',
    commissionVat: 'Komisyon KDV',
    shippingVat: 'Kargo KDV',
    outboundShippingVat: 'Gidiş kargo KDV',
    returnShippingVat: 'İade kargo KDV',
    platformServiceVat: 'Platform hizmet bedeli KDV',
    internationalService: 'Uluslararası hizmet bedeli',
    overseasReturnOperation: 'Yurt dışı iade operasyon bedeli',
    internationalServiceVat: 'Uluslararası hizmet bedeli KDV',
    overseasReturnOperationVat: 'Yurt dışı iade operasyon bedeli KDV',
    microExport: 'Mikro İhracat',
    exportVatExemption: 'KDV %0 — İhracat istisnası',
    margin: 'Kâr marjı',
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
  outboundShippingGross: '135.32',
  outboundShippingVat: '22.55',
  returnShippingGross: '0.00',
  returnShippingVat: '0.00',
  platformServiceGross: '13.19',
  platformServiceVat: '2.20',
  // Mikro ihracat ücretleri — normal (non-micro) siparişte '0.00' (satır gizli).
  internationalServiceGross: '0.00',
  internationalServiceVat: '0.00',
  overseasReturnOperationGross: '0.00',
  overseasReturnOperationVat: '0.00',
  // Stopaj ayrı düşülen brüt terim (KDV-siz). 569592424: kâr 876,24 yerine 848,74
  // → fark tam 27,50 stopaj. Σ düşülen + Net KDV = saleGross − netProfit ile kapanır.
  stoppage: '27.50',
  netVat: '175.25',
  netProfit: '848.74',
  saleMarginPct: '25.7',
  costMarkupPct: '58.9',
};

// Mikro ihracat: satış KDV %0 + Uluslararası Hizmet Bedeli (KDV'li) + Yurt Dışı İade
// Operasyon Bedeli (şu an KDV-siz). Gerçek stage siparişi 775882190 mertebesinde.
const MICRO_BREAKDOWN = {
  ...BREAKDOWN,
  saleVat: '0.00',
  internationalServiceGross: '46.46',
  internationalServiceVat: '7.74',
  overseasReturnOperationGross: '219.50',
  overseasReturnOperationVat: '0.00',
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
    // Düşülen kalem etiketleri + Stopaj (ayrı düşülen satır) + son kâr.
    for (const label of [
      'Satış',
      'Ürün maliyeti',
      'Komisyon',
      'Kargo',
      'Platform hizmet bedeli',
      'Stopaj',
      'Tahmini kâr',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Değerler backend'den; bileşen yalnız formatlar.
    expect(screen.getByText(formatCurrency('3300.00'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('848.74'))).toBeInTheDocument();
    // Stopaj satırı backend-servisli tutarı gösterir (şeffaflık değişmezi).
    expect(screen.getByText(formatCurrency('27.50'))).toBeInTheDocument();
    // Marj backend-servisli (saleMarginPct) — frontend türetmez, render eder.
    expect(screen.getByText('Kâr marjı')).toBeInTheDocument();
    expect(screen.getByText('25.7%')).toBeInTheDocument();
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

  it('hides the stoppage row when there is no withholding tax (0.00)', () => {
    // Teslim öncesi siparişte stopaj kesilmez → '0.00' → gürültü yapmamak için
    // satır gizlenir (sellerDiscount şeffaflık deseniyle aynı koşullu render).
    renderCard({ ...BREAKDOWN, stoppage: '0.00' });
    expect(screen.queryByText('Stopaj')).not.toBeInTheDocument();
  });

  it('hides the platform service fee row when zero (e.g. micro export PSF exemption)', () => {
    // PSF mikro ihracatta muaf → '0.00' → satır gizlenir (stopaj deseniyle aynı).
    renderCard({ ...BREAKDOWN, platformServiceGross: '0.00', platformServiceVat: '0.00' });
    expect(screen.queryByText('Platform hizmet bedeli')).not.toBeInTheDocument();
  });

  it('shows promotion names near the discount line when promotionDisplays are present', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <ProfitBreakdownCard
          breakdown={{ ...BREAKDOWN, listGross: '3500.00', sellerDiscountGross: '200.00' }}
          promotionDisplays={[{ displayName: 'Sepette %10 İndirim', amountGross: '200.00' }]}
        />
      </NextIntlClientProvider>,
    );
    // Promosyon grup etiketi + promosyon adı (backend yakaladı, frontend render eder).
    expect(screen.getByText('Promosyonlar')).toBeInTheDocument();
    expect(screen.getByText('Sepette %10 İndirim')).toBeInTheDocument();
  });

  it('does not render the promotion section when promotionDisplays is absent', () => {
    renderCard({ ...BREAKDOWN, listGross: '3500.00', sellerDiscountGross: '200.00' });
    expect(screen.queryByText('Promosyonlar')).not.toBeInTheDocument();
  });

  it('shows the unavailable message when there is no breakdown', () => {
    renderCard(null);
    expect(screen.getByText('Bu sipariş için kâr hesaplanmadı.')).toBeInTheDocument();
    expect(screen.queryByText('Kâr dökümü')).toBeInTheDocument(); // başlık sabit kalır
    expect(screen.queryByText('Satış')).not.toBeInTheDocument();
  });

  it('shows a single plain "Kargo" row when there is no return shipping', () => {
    renderCard(BREAKDOWN); // returnShippingGross '0.00'
    expect(screen.getByText('Kargo')).toBeInTheDocument();
    // İadesiz → collapsible toplam / iade alt satırı YOK.
    expect(screen.queryByText('Toplam kargo bedeli')).not.toBeInTheDocument();
    expect(screen.queryByText('İade kargosu')).not.toBeInTheDocument();
  });

  it('splits cargo into a collapsible total (outbound + return) when the order has return shipping', async () => {
    const user = userEvent.setup();
    renderCard({
      ...BREAKDOWN,
      shippingGross: '280.32', // 135.32 gidiş + 145.00 iade
      shippingVat: '46.72',
      outboundShippingGross: '135.32',
      outboundShippingVat: '22.55',
      returnShippingGross: '145.00',
      returnShippingVat: '24.17',
    });

    // Toplam başlık görünür; düz tek "Kargo" satırı yerini collapsible'a bıraktı.
    expect(screen.getByText('Toplam kargo bedeli')).toBeInTheDocument();
    // Kapalıyken alt satırlar DOM'da değil (Radix unmount).
    expect(screen.queryByText('Gidiş kargosu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Toplam kargo bedeli/ }));

    expect(screen.getByText('Gidiş kargosu')).toBeInTheDocument();
    expect(screen.getByText('İade kargosu')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('135.32'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('145.00'))).toBeInTheDocument();
  });

  it('splits the shipping VAT into outbound + return rows in the Net VAT breakdown on return', async () => {
    const user = userEvent.setup();
    renderCard({
      ...BREAKDOWN,
      shippingGross: '280.32',
      shippingVat: '46.72',
      outboundShippingGross: '135.32',
      outboundShippingVat: '22.55',
      returnShippingGross: '145.00',
      returnShippingVat: '24.17',
    });

    await user.click(screen.getByRole('button', { name: /Net KDV/ }));

    expect(screen.getByText('Gidiş kargo KDV')).toBeInTheDocument();
    expect(screen.getByText('İade kargo KDV')).toBeInTheDocument();
    // İade varken tek birleşik "Kargo KDV" satırı YOK.
    expect(screen.queryByText('Kargo KDV')).not.toBeInTheDocument();
  });

  it('shows the micro export badge and VAT-exemption note when micro', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <ProfitBreakdownCard breakdown={{ ...BREAKDOWN, saleVat: '0.00' }} micro />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Mikro İhracat')).toBeInTheDocument();
    expect(screen.getByText('KDV %0 — İhracat istisnası')).toBeInTheDocument();
  });

  it('does not show the micro badge / exemption note for a normal order', () => {
    renderCard(BREAKDOWN); // micro varsayılan false
    expect(screen.queryByText('Mikro İhracat')).not.toBeInTheDocument();
    expect(screen.queryByText('KDV %0 — İhracat istisnası')).not.toBeInTheDocument();
  });

  it('renders the micro export fee deduction rows when present', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <ProfitBreakdownCard breakdown={MICRO_BREAKDOWN} micro />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Uluslararası hizmet bedeli')).toBeInTheDocument();
    expect(screen.getByText('Yurt dışı iade operasyon bedeli')).toBeInTheDocument();
    // Tutarlar backend-servisli; bileşen yalnız formatlar (SignedAmount magnitude).
    expect(screen.getByText(formatCurrency('46.46'))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency('219.50'))).toBeInTheDocument();
  });

  it('hides the micro export fee rows when zero (normal order)', () => {
    renderCard(BREAKDOWN); // mikro ücretler '0.00'
    expect(screen.queryByText('Uluslararası hizmet bedeli')).not.toBeInTheDocument();
    expect(screen.queryByText('Yurt dışı iade operasyon bedeli')).not.toBeInTheDocument();
  });

  it('shows the international service VAT row in the Net VAT breakdown; hides the zero-VAT return fee', async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <ProfitBreakdownCard breakdown={MICRO_BREAKDOWN} micro />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: /Net KDV/ }));

    expect(screen.getByText('Uluslararası hizmet bedeli KDV')).toBeInTheDocument();
    // Yurt dışı iade bedeli şu an KDV-siz ('0.00') → KDV satırı gizli (data-driven).
    expect(screen.queryByText('Yurt dışı iade operasyon bedeli KDV')).not.toBeInTheDocument();
  });
});
