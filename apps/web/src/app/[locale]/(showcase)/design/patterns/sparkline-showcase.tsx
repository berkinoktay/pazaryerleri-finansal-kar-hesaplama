'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { KpiTile } from '@/components/patterns/kpi-tile';
import { Sparkline } from '@/components/patterns/sparkline';
import { StatGroup } from '@/components/patterns/stat-group';
import { TrendDelta } from '@/components/patterns/trend-delta';

// Synthetic 14-day series with realistic dashboard shapes — caller code
// would derive these from React Query results or pre-aggregated rollups.
const REVENUE_SERIES = [
  18420, 21340, 19880, 24120, 22650, 27410, 25980, 28220, 26540, 31840, 33120, 30880, 35200, 37640,
];

const ORDER_SERIES = [142, 148, 132, 158, 152, 167, 161, 174, 169, 188, 195, 184, 207, 218];

const REFUND_SERIES = [12, 8, 15, 9, 7, 11, 13, 18, 22, 19, 14, 21, 25, 28];

const STALL_SERIES = [40, 41, 39, 40, 38, 40, 41, 40, 39, 40, 41, 40, 39, 40];

interface RowDatum {
  product: string;
  netProfit: Decimal;
  trend: number[];
  tone: 'success' | 'warning' | 'destructive';
  deltaPercent: number;
}

const ROW_DATA: RowDatum[] = [
  {
    product: 'iPhone 15 silikon kılıf',
    netProfit: new Decimal('12320.50'),
    trend: [180, 220, 240, 280, 310, 340, 380],
    tone: 'success',
    deltaPercent: 8.4,
  },
  {
    product: 'Bluetooth kulaklık (TWS)',
    netProfit: new Decimal('-1240.30'),
    trend: [420, 380, 340, 290, 240, 180, 120],
    tone: 'destructive',
    deltaPercent: -22.1,
  },
  {
    product: 'Powerbank 20.000 mAh',
    netProfit: new Decimal('4080.40'),
    trend: [180, 195, 188, 210, 205, 218, 222],
    tone: 'success',
    deltaPercent: 18.4,
  },
];

export function SparklineShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          KpiTile içinde — son 14 gün trendi
        </span>
        <StatGroup>
          <KpiTile
            label="Ciro"
            value={{ kind: 'currency', amount: new Decimal('37640') }}
            delta={{ percent: 12.4, goodDirection: 'up' }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={REVENUE_SERIES} tone="success" />
                <span className="text-2xs text-muted-foreground">son 14 gün</span>
              </span>
            }
          />
          <KpiTile
            label="Sipariş"
            value={{ kind: 'count', amount: 218 }}
            delta={{ percent: 9.5, goodDirection: 'up' }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={ORDER_SERIES} tone="success" />
                <span className="text-2xs text-muted-foreground">son 14 gün</span>
              </span>
            }
          />
          <KpiTile
            label="İade"
            value={{ kind: 'count', amount: 28 }}
            delta={{ percent: 22.5, goodDirection: 'down' }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={REFUND_SERIES} tone="destructive" />
                <span className="text-2xs text-muted-foreground">son 14 gün</span>
              </span>
            }
          />
          <KpiTile
            label="Aktif sync"
            value={{ kind: 'count', amount: 40 }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={STALL_SERIES} tone="neutral" />
                <span className="text-2xs text-muted-foreground">son 14 gün — düz</span>
              </span>
            }
          />
        </StatGroup>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Tablo hücresinde — ürün başına 7-gün trendi
        </span>
        <div className="border-border bg-card overflow-hidden rounded-md border">
          <table className="w-full">
            <thead className="bg-muted/40 border-border border-b">
              <tr>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-left font-medium">
                  Ürün
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                  Net kar
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-center font-medium">
                  7 gün
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium">
                  Δ
                </th>
              </tr>
            </thead>
            <tbody>
              {ROW_DATA.map((row) => (
                <tr key={row.product} className="border-border border-b last:border-0">
                  <td className="px-sm py-sm text-foreground text-sm font-medium">{row.product}</td>
                  <td className="px-sm py-sm text-right">
                    <Currency value={row.netProfit} emphasis />
                  </td>
                  <td className="px-sm py-sm text-center">
                    <Sparkline data={row.trend} tone={row.tone} width={100} height={28} />
                  </td>
                  <td className="px-sm py-sm text-right">
                    <TrendDelta value={row.deltaPercent} goodDirection="up" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="text-2xs text-muted-foreground">
          Her satırın trend yönü tone seçimini yönlendirir — düşüşte destructive, çıkışta success.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Variant: line — area dolgusu olmadan
        </span>
        <div className="border-border bg-card p-md gap-md flex flex-wrap items-center rounded-md border">
          <div className="gap-xs flex items-center">
            <Sparkline data={REVENUE_SERIES} tone="success" variant="line" />
            <span className="text-2xs text-muted-foreground">Ciro · success</span>
          </div>
          <div className="gap-xs flex items-center">
            <Sparkline data={ORDER_SERIES} tone="info" variant="line" />
            <span className="text-2xs text-muted-foreground">Sipariş · info</span>
          </div>
          <div className="gap-xs flex items-center">
            <Sparkline data={REFUND_SERIES} tone="warning" variant="line" />
            <span className="text-2xs text-muted-foreground">İade · warning</span>
          </div>
          <div className="gap-xs flex items-center">
            <Sparkline data={STALL_SERIES} tone="neutral" variant="line" />
            <span className="text-2xs text-muted-foreground">Aktif sync · neutral</span>
          </div>
        </div>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boş seri — placeholder kutu
        </span>
        <div className="border-border bg-card p-md gap-md flex items-center rounded-md border">
          <Sparkline data={[]} ariaLabel="Veri yok" />
          <span className="text-2xs text-muted-foreground">
            data=[] → tone-neutral muted dolgu, yer tutar.
          </span>
        </div>
      </div>
    </div>
  );
}
