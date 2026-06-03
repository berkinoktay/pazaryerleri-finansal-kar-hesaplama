'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Sparkline } from '@/components/patterns/sparkline';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';

// Synthetic 14-day series with realistic dashboard shapes — caller code
// would derive these from React Query results or pre-aggregated rollups.
const REVENUE_SERIES = [
  18420, 21340, 19880, 24120, 22650, 27410, 25980, 28220, 26540, 31840, 33120, 30880, 35200, 37640,
];

const ORDER_SERIES = [142, 148, 132, 158, 152, 167, 161, 174, 169, 188, 195, 184, 207, 218];

const REFUND_SERIES = [12, 8, 15, 9, 7, 11, 13, 18, 22, 19, 14, 21, 25, 28];

const STALL_SERIES = [40, 41, 39, 40, 38, 40, 41, 40, 39, 40, 41, 40, 39, 40];

const SPARKLINE_VARIANTS = ['area', 'line', 'bars'] as const;
const SPARKLINE_TONES = ['neutral', 'success', 'warning', 'destructive', 'info'] as const;

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
      <Playground
        title="Sparkline — variant · tone"
        description="variant: area (gradient dolgulu), line (stroke-only), bars (ince yuvarlatılmış kolonlar). tone TrendDelta + Badge ile aynı semantic vocabulary — yükselen metrik success, düşen maliyet destructive."
        controls={{
          variant: control.segment(SPARKLINE_VARIANTS, 'area'),
          tone: control.segment(SPARKLINE_TONES, 'success'),
        }}
        render={(v) => (
          <Sparkline
            data={REVENUE_SERIES}
            variant={v.variant}
            tone={v.tone}
            width={120}
            height={32}
          />
        )}
      />

      <Preview
        title="StatCard içinde — son 14 gün trendi"
        description="StatCard context slot'unda Sparkline + 'son 14 gün' etiketi. Trend yönü tone'u sürer: ciro/sipariş success, iade destructive (goodDirection='down'), düz sync neutral."
      >
        <StatGroup>
          <StatCard
            label="Ciro"
            value={<Currency value={new Decimal('37640')} />}
            delta={{ percent: 12.4, goodDirection: 'up' }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={REVENUE_SERIES} tone="success" />
                <span className="text-2xs text-muted-foreground">son 14 gün</span>
              </span>
            }
          />
          <StatCard
            label="Sipariş"
            value={218}
            delta={{ percent: 9.5, goodDirection: 'up' }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={ORDER_SERIES} tone="success" />
                <span className="text-2xs text-muted-foreground">son 14 gün</span>
              </span>
            }
          />
          <StatCard
            label="İade"
            value={28}
            delta={{ percent: 22.5, goodDirection: 'down' }}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={REFUND_SERIES} tone="destructive" />
                <span className="text-2xs text-muted-foreground">son 14 gün</span>
              </span>
            }
          />
          <StatCard
            label="Aktif sync"
            value={40}
            context={
              <span className="gap-xs flex items-center">
                <Sparkline data={STALL_SERIES} tone="neutral" />
                <span className="text-2xs text-muted-foreground">son 14 gün — düz</span>
              </span>
            }
          />
        </StatGroup>
      </Preview>

      <Preview
        title="Tablo hücresinde — ürün başına 7-gün trendi"
        description="width / height ile hücre footprint'ine sığar. Her satırın trend yönü tone seçimini yönlendirir — düşüşte destructive, çıkışta success."
      >
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
      </Preview>

      <Preview
        title="Boş seri — placeholder kutu"
        description="data=[] → tone-neutral muted dolgu, istenen footprint'i yer tutar (chart hiç çizilmez)."
      >
        <div className="gap-md flex items-center">
          <Sparkline data={[]} ariaLabel="Veri yok" />
          <span className="text-2xs text-muted-foreground">data=[] → muted placeholder.</span>
        </div>
      </Preview>
    </div>
  );
}
