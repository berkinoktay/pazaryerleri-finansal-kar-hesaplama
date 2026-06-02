'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { ProfitCell } from '@/components/patterns/profit-cell';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';

const SAMPLE_VALUE = new Decimal('12320.50');
const DELTA_PERCENT = 8.4;

interface MockRow {
  id: string;
  product: string;
  revenue: Decimal;
  netProfit: Decimal;
  margin: Decimal;
  netDeltaPercent: number;
  marginDeltaPercent: number;
}

const ROWS: MockRow[] = [
  {
    id: '1',
    product: 'iPhone 15 silikon kılıf',
    revenue: new Decimal('38450.00'),
    netProfit: new Decimal('12320.50'),
    margin: new Decimal('32.05'),
    netDeltaPercent: 8.4,
    marginDeltaPercent: 2.1,
  },
  {
    id: '2',
    product: 'Bluetooth kulaklık (TWS)',
    revenue: new Decimal('22180.00'),
    netProfit: new Decimal('-1240.30'),
    margin: new Decimal('-5.59'),
    netDeltaPercent: -22.1,
    marginDeltaPercent: -8.4,
  },
  {
    id: '3',
    product: 'Powerbank 20.000 mAh',
    revenue: new Decimal('14920.00'),
    netProfit: new Decimal('4080.40'),
    margin: new Decimal('27.35'),
    netDeltaPercent: 0,
    marginDeltaPercent: 0.4,
  },
];

export function ProfitCellShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="ProfitCell — layout · delta · emphasis · dimWhenZero"
        description="delta='none' → delta atlanır, ProfitCell düz Currency render eder. delta='up' ciro/kar (artış iyi), 'down' maliyet/iade (düşüş iyi). dimWhenZero değeri ₺0 ise siliklestirir; örnekte gerçek değer pozitif olduğundan etkisi sıfır değerlerde görünür."
        controls={{
          layout: control.segment(['stacked', 'inline'], 'stacked'),
          delta: control.segment(['up', 'down', 'none'], 'up'),
          emphasis: control.bool(true, 'emphasis'),
          dimWhenZero: control.bool(false, 'dimWhenZero'),
        }}
        render={(v) => (
          <ProfitCell
            value={SAMPLE_VALUE}
            layout={v.layout}
            emphasis={v.emphasis}
            dimWhenZero={v.dimWhenZero}
            delta={
              v.delta === 'none' ? undefined : { percent: DELTA_PERCENT, goodDirection: v.delta }
            }
          />
        )}
      />

      <Preview
        title="Stacked — ürün karlılık tablosu (in-context)"
        description="Tablo kolonlarında stacked + align='right' (default) → tabular finansal hizalama. Net kar ve marj kolonları delta'lı; ciro deltasız düz Currency. Negatif değer + negatif delta kombinasyonu da burada görünür."
      >
        <div className="border-border bg-card overflow-hidden rounded-md border">
          <table className="w-full">
            <thead className="bg-muted/40 border-border border-b">
              <tr>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-left font-medium">
                  Ürün
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                  Ciro
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                  Net kar (Δ)
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                  Marj (Δ)
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.id} className="border-border border-b last:border-0">
                  <td className="px-sm py-sm text-foreground text-sm font-medium">{row.product}</td>
                  <td className="px-sm py-sm">
                    <ProfitCell value={row.revenue} />
                  </td>
                  <td className="px-sm py-sm">
                    <ProfitCell
                      value={row.netProfit}
                      delta={{ percent: row.netDeltaPercent, goodDirection: 'up' }}
                      emphasis
                    />
                  </td>
                  <td className="px-sm py-sm">
                    <ProfitCell
                      value={row.margin}
                      delta={{ percent: row.marginDeltaPercent, goodDirection: 'up' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Preview>
    </div>
  );
}
