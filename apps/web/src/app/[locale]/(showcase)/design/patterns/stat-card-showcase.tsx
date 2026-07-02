'use client';

import Decimal from 'decimal.js';
import {
  Analytics01Icon,
  ArrowRight01Icon,
  Calendar01Icon,
  Coins01Icon,
  PackageIcon,
  ShoppingBag01Icon,
} from 'hugeicons-react';
import * as React from 'react';

import { BarChart } from '@/components/patterns/chart-bar';
import { DonutChart } from '@/components/patterns/chart-donut';
import { Currency } from '@/components/patterns/currency';
import { DistributionBar } from '@/components/patterns/distribution-bar';
import { InfoHint } from '@/components/patterns/info-hint';
import { Sparkline } from '@/components/patterns/sparkline';
import { StatCard, type StatCardProps } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';
import { StatStrip } from '@/components/patterns/stat-strip';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const TREND_SERIES = [42, 68, 34, 88, 56, 100, 72, 64, 92, 78];
const HERO_SERIES = [12, 18, 15, 24, 22, 30, 28, 34, 40, 44];

const circleIcon = (icon: React.ReactNode): React.ReactElement => (
  <SoftSquareIcon shape="circle" variant="outline" size="lg">
    {icon}
  </SoftSquareIcon>
);

/** Loading strip — same config, `loading` swaps values/context for skeletons. */
export function StatStripLoadingShowcase(): React.ReactElement {
  return (
    <StatStrip
      loading
      loadingLabel="Yükleniyor"
      items={[
        { label: 'Sipariş', value: null, icon: circleIcon(<ShoppingBag01Icon />) },
        { label: 'Ciro', value: null, icon: circleIcon(<PackageIcon />) },
        { label: 'Net Kâr', value: null, icon: circleIcon(<Analytics01Icon />) },
        { label: 'Gider', value: null, icon: circleIcon(<Coins01Icon />) },
      ]}
    />
  );
}

/** Segmented strip — at-a-glance KPI header band (StatStrip + outline icons). */
export function StatStripShowcase(): React.ReactElement {
  return (
    <StatStrip
      items={[
        {
          label: 'Sipariş',
          value: '5.868',
          icon: circleIcon(<ShoppingBag01Icon />),
          delta: { percent: 18, goodDirection: 'up', period: 'Son 7 gün' },
        },
        {
          label: 'Ciro',
          value: <Currency value={new Decimal('96850')} />,
          hint: 'Seçili dönemde tüm siparişlerin KDV dahil toplam satış tutarı.',
          icon: circleIcon(<PackageIcon />),
          delta: { percent: -5, goodDirection: 'up', period: 'Son 7 gün' },
        },
        {
          label: 'Net Kâr',
          value: <Currency value={new Decimal('82906')} />,
          hint: 'Komisyon, kargo, hizmet bedeli ve giderler düşüldükten sonra kalan gerçek kazanç.',
          icon: circleIcon(<Analytics01Icon />),
          delta: { percent: 18, goodDirection: 'up', period: 'Son 7 gün' },
        },
        {
          label: 'Gider',
          value: <Currency value={new Decimal('14653')} />,
          icon: circleIcon(<Coins01Icon />),
          delta: { percent: -5, goodDirection: 'down', period: 'Son 7 gün' },
        },
      ]}
    />
  );
}

/** Standalone tiles — icon-hero, metric + inline trend, and an action card. */
export function StatCardTilesShowcase(): React.ReactElement {
  return (
    <div className="gap-md grid grid-cols-1 lg:grid-cols-3">
      <StatCard
        label="Toplam Satış"
        icon={
          <SoftSquareIcon shape="circle" variant="soft" size="lg">
            <ShoppingBag01Icon />
          </SoftSquareIcon>
        }
        value={<Currency value={new Decimal('345678')} />}
        delta={{ percent: 8, goodDirection: 'up', period: 'geçen haftaya göre' }}
      />
      <StatCard
        label="Toplam Ciro"
        hint="Seçili dönemde tüm bağlı mağazalardan gelen KDV dahil brüt satış toplamı."
        value={<Currency value={new Decimal('45320')} />}
        delta={{
          percent: 18,
          goodDirection: 'up',
          absolute: <Currency value={new Decimal('1470')} />,
        }}
        trend={
          <Sparkline variant="bars" tone="success" data={TREND_SERIES} width={96} height={56} />
        }
      />
      <StatCard
        emphasis
        label="Haftalık Satış"
        icon={circleIcon(<Calendar01Icon />)}
        iconPosition="trailing"
        value={<Currency value={new Decimal('4587')} />}
        delta={{ percent: 18, goodDirection: 'up' }}
        action={
          <Button variant="outline" size="sm" className="gap-2xs">
            Raporu gör
            <ArrowRight01Icon className="size-icon-sm" />
          </Button>
        }
      />
    </div>
  );
}

/** Rich cards — a distribution breakdown and a multi-metric hero (composition). */
export function StatCardRichShowcase(): React.ReactElement {
  return (
    <div className="gap-md grid grid-cols-1 lg:grid-cols-2">
      <StatCard
        emphasis
        label="Toplam Varlık"
        hint="Ürün satışı, hizmet geliri ve diğer gelirlerin birleşik toplam değeri."
        value={<Currency value={new Decimal('478230')} />}
        delta={{
          percent: 14.6,
          goodDirection: 'up',
          absolute: <Currency value={new Decimal('65000')} />,
          period: 'geçen yıla göre',
        }}
      >
        <div className="gap-sm flex flex-col">
          <span className="text-2xs text-muted-foreground-dim font-medium tracking-wide uppercase">
            Dağılım
          </span>
          <DistributionBar
            ariaLabel="Gelir dağılımı"
            segments={[
              {
                label: 'Ürün Satışı',
                value: <Currency value={new Decimal('312500')} />,
                percent: 65,
                color: 'var(--color-chart-1)',
              },
              {
                label: 'Hizmet Geliri',
                value: <Currency value={new Decimal('125000')} />,
                percent: 26,
                color: 'var(--color-chart-4)',
              },
              {
                label: 'Diğer Gelir',
                value: <Currency value={new Decimal('40730')} />,
                percent: 9,
                color: 'var(--color-chart-3)',
              },
            ]}
          />
        </div>
      </StatCard>

      {/* Multi-metric hero — a composition (no dedicated component): one Card,
          two metric blocks + an area trend. */}
      <Card className="p-lg gap-md flex flex-col">
        <div className="gap-3xs flex flex-col">
          <span className="text-foreground text-lg font-semibold tracking-tight">
            Analiz Panosu
          </span>
          <span className="text-muted-foreground text-sm">Tüm istatistiklere göz at</span>
        </div>
        <div className="flex">
          <div className="pr-lg gap-2xs flex flex-col">
            <span className="text-2xs text-muted-foreground inline-flex items-center font-medium tracking-wide uppercase">
              Kazanç
              <InfoHint label="Kazanç">
                Dönem içi tüm gelir kalemlerinin toplamı (gider düşülmeden).
              </InfoHint>
            </span>
            <span className="gap-xs flex items-center">
              <span className="text-foreground text-2xl font-semibold tracking-tight tabular-nums">
                <Currency value={new Decimal('27850')} />
              </span>
              <TrendDelta value={18} goodDirection="up" />
            </span>
          </div>
          <div className="border-border-muted pl-lg gap-2xs flex flex-col border-l">
            <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
              Gider
            </span>
            <span className="gap-xs flex items-center">
              <span className="text-foreground text-2xl font-semibold tracking-tight tabular-nums">
                <Currency value={new Decimal('18453')} />
              </span>
              <TrendDelta value={-5} goodDirection="down" />
            </span>
          </div>
        </div>
        <Sparkline
          variant="area"
          tone="success"
          data={HERO_SERIES}
          width={520}
          height={64}
          className="w-full"
        />
      </Card>
    </div>
  );
}

// Real chart-kit components dropped into a StatCard's children slot — proves the
// card hosts the recharts kit (DonutChart / BarChart) with no overflow, so a real
// page can use the kit wherever recharts manages a chart better than the inline
// Sparkline / DistributionBar. The slots are plain ReactNode — nothing is baked in.
const KIT_EXPENSE = [
  { label: 'Komisyon', value: 2930 },
  { label: 'Kargo', value: 1180 },
  { label: 'Reklam', value: 640 },
  { label: 'Hizmet Bedeli', value: 420 },
];
const KIT_REVENUE = [
  { month: 'Oca', ciro: 184000 },
  { month: 'Şub', ciro: 212000 },
  { month: 'Mar', ciro: 246000 },
  { month: 'Nis', ciro: 228000 },
  { month: 'May', ciro: 284000 },
  { month: 'Haz', ciro: 312000 },
];

/** Proof of composability: the REAL chart kit (DonutChart / BarChart) inside StatCard children. */
export function StatCardChartKitShowcase(): React.ReactElement {
  return (
    <div className="gap-md grid grid-cols-1 lg:grid-cols-2">
      <StatCard
        emphasis
        label="Gider Dağılımı"
        hint="Kart, kit'in GERÇEK DonutChart'ını children slot'unda barındırıyor — DistributionBar zorunlu değil."
        value={<Currency value={5170} />}
        delta={{ percent: -8, goodDirection: 'down', period: 'geçen aya göre' }}
      >
        <div className="h-56">
          <DonutChart data={KIT_EXPENSE} format="currency" centerLabel="Toplam Gider" />
        </div>
      </StatCard>

      <StatCard
        label="Aylık Ciro"
        value={<Currency value={312000} />}
        delta={{ percent: 9.8, goodDirection: 'up', period: 'geçen aya göre' }}
      >
        <div className="h-48">
          <BarChart
            data={KIT_REVENUE}
            xKey="month"
            series={{ key: 'ciro', label: 'Ciro', format: 'currency' }}
            colorMode="brand"
          />
        </div>
      </StatCard>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: 'ready', label: 'Dolu' },
  { value: 'loading', label: 'Yükleniyor' },
  { value: 'empty', label: 'Boş' },
  { value: 'error', label: 'Hata' },
] as const;

/** Status states + whole-card drill-down (hover lift). */
export function StatCardStatesShowcase(): React.ReactElement {
  const [status, setStatus] = React.useState<NonNullable<StatCardProps['status']>>('ready');
  return (
    <div className="gap-md flex flex-col">
      <ToggleGroup
        type="single"
        value={status}
        onValueChange={(next) => {
          const option = STATUS_OPTIONS.find((candidate) => candidate.value === next);
          if (option) setStatus(option.value);
        }}
        size="sm"
        aria-label="Kart durumu"
        className="self-start"
      >
        {STATUS_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <StatGroup>
        <StatCard
          label="Net Kâr"
          hint="Komisyon, kargo ve giderler düşülmüş gerçek kazanç."
          icon={
            <SoftSquareIcon shape="circle" variant="soft" size="lg">
              <Analytics01Icon />
            </SoftSquareIcon>
          }
          value={<Currency value={new Decimal('82906')} />}
          delta={{ percent: 18, goodDirection: 'up', period: 'geçen haftaya göre' }}
          status={status}
          onRetry={() => setStatus('ready')}
        />
        <StatCard
          href="#"
          label="Bekleyen Tahsilat"
          value={<Currency value={new Decimal('74120')} />}
          context="6 mağazadan 1'i riskli — detaya git"
        />
      </StatGroup>
    </div>
  );
}

/** Standalone InfoHint — the generic ⓘ + tooltip atom. */
export function InfoHintShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-wrap items-center text-sm">
      <span className="text-muted-foreground inline-flex items-center">
        Marj
        <InfoHint label="Marj">Net kârın ciroya oranı — yüzde olarak kârlılık.</InfoHint>
      </span>
      <span className="text-muted-foreground inline-flex items-center">
        Desi
        <InfoHint side="right">
          Kargo ücretini belirleyen hacimsel ağırlık (en × boy × yükseklik / 3000).
        </InfoHint>
      </span>
      <span className="text-muted-foreground inline-flex items-center">
        Settlement
        <InfoHint label="Mutabakat" side="bottom">
          Pazaryerinin kesinleşmiş hakediş faturası — tahmini değil, gerçekleşen tutar.
        </InfoHint>
      </span>
    </div>
  );
}
