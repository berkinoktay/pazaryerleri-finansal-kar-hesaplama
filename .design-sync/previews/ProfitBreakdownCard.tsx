import { ProfitBreakdownCard } from '@pazarsync/web';

// Şekil: components['schemas']['ProfitBreakdown'] — tüm tutarlar string (decimal).
const BREAKDOWN = {
  listGross: '189.90',
  sellerDiscountGross: '20.00',
  saleGross: '169.90',
  saleVat: '28.32',
  costGross: '72.00',
  costVat: '12.00',
  commissionGross: '40.18',
  commissionVat: '6.70',
  shippingGross: '34.99',
  shippingVat: '5.83',
  outboundShippingGross: '34.99',
  outboundShippingVat: '5.83',
  returnShippingGross: '0.00',
  returnShippingVat: '0.00',
  platformServiceGross: '6.99',
  platformServiceVat: '1.17',
  stoppage: '1.70',
  netVat: '1.92',
  netProfit: '13.34',
  saleMarginPct: '7.85',
  costMarkupPct: '18.53',
};

export const Default = () => (
  <div className="max-w-modal w-full">
    <ProfitBreakdownCard breakdown={BREAKDOWN} />
  </div>
);
