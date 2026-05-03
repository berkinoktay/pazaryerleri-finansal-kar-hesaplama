'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { ProfitCell } from '@/components/patterns/profit-cell';

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
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Stacked (default) — ürün karlılık tablosu
        </span>
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
        <span className="text-2xs text-muted-foreground">
          Stacked + alignRight (default) → tabular finansal kolonlar.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Inline — sıkışık özet satırı
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">Bugün net kar</span>
            <ProfitCell
              value={new Decimal('48120.80')}
              delta={{ percent: 8.1, goodDirection: 'up' }}
              layout="inline"
              emphasis
            />
          </div>
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">Reklam gideri</span>
            <ProfitCell
              value={new Decimal('3250.00')}
              delta={{ percent: 14.2, goodDirection: 'down' }}
              layout="inline"
            />
          </div>
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">İade tutarı</span>
            <ProfitCell
              value={new Decimal('1240.50')}
              delta={{ percent: -6.5, goodDirection: 'down' }}
              layout="inline"
            />
          </div>
        </div>
        <span className="text-2xs text-muted-foreground">
          goodDirection=&quot;down&quot; → reklam / iade gibi düşmesi iyi olan metrikler.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Delta yok — düz Currency davranışı
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col items-end rounded-md border">
          <ProfitCell value={new Decimal('249.90')} />
          <ProfitCell value={new Decimal('1284.39')} emphasis />
          <ProfitCell value={0} dimWhenZero />
        </div>
        <span className="text-2xs text-muted-foreground">
          delta atlanırsa ProfitCell sadece Currency render eder; emphasis + dimWhenZero forward
          edilir.
        </span>
      </div>
    </div>
  );
}
