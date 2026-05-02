'use client';

import Decimal from 'decimal.js';
import { DatabaseIcon, ShoppingBag01Icon } from 'hugeicons-react';

import { BadgeWithOverflow } from '@/components/patterns/badge-with-overflow';
import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { KpiTile } from '@/components/patterns/kpi-tile';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { PageHeader } from '@/components/patterns/page-header';
import { StatGroup } from '@/components/patterns/stat-group';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Preview } from '@/components/showcase/preview';
import { Button } from '@/components/ui/button';

const MOCK = {
  revenue: new Decimal('284390.45'),
  profit: new Decimal('48120.80'),
  sampleAmount: new Decimal('1284.39'),
  emphasisAmount: new Decimal('48120.80'),
  negativeAmount: new Decimal('-248.15'),
};

export default function DisplayPatternsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Görsel & sayısal pattern'lar"
        intent="Veri-okuma yüzeyleri: KPI tile, sayı/yüzde delta, currency, boş durum, badge'ler, marketplace logoları."
      />
      <PatternNav />

      <Preview
        title="KpiTile + StatGroup"
        description="Değer-birinci hiyerarşi. Delta chip ikon + renk + işaret ile; renk asla tek sinyal değil. StatGroup auto-fit grid; tile'lar viewport'a göre yeniden hizalanır."
      >
        <StatGroup>
          <KpiTile
            label="Ciro"
            value={{ kind: 'currency', amount: MOCK.revenue }}
            delta={{ percent: 12.4, goodDirection: 'up' }}
            context="Dün: ₺252.980 · Trendyol Ana Mağaza"
          />
          <KpiTile
            label="Net kar"
            value={{ kind: 'currency', amount: MOCK.profit }}
            delta={{ percent: 8.1, goodDirection: 'up' }}
            context="Marj %16.9 · Nisan 2026"
          />
          <KpiTile
            label="Sipariş"
            value={{ kind: 'count', amount: 1472 }}
            delta={{ percent: -3.2, goodDirection: 'up' }}
            context="Nisan 1-17 · Bugün: 82"
          />
          <KpiTile
            label="İade"
            value={{ kind: 'count', amount: 38 }}
            delta={{ percent: -14.2, goodDirection: 'down' }}
            context="İade oranı %2.6"
          />
        </StatGroup>
      </Preview>

      <Preview
        title="TrendDelta"
        description="Ciro için yukarı iyi; iade için aşağı iyi. `goodDirection` ile anlamsal kontrol. İkon + renk + işaret üç bağımsız kanal."
      >
        <div className="gap-md flex flex-wrap">
          <TrendDelta value={12.4} goodDirection="up" />
          <TrendDelta value={-3.2} goodDirection="up" />
          <TrendDelta value={0} />
          <TrendDelta value={14.2} goodDirection="down" />
          <TrendDelta value={-6.1} goodDirection="down" />
          <TrendDelta value={25} size="md" />
        </div>
      </Preview>

      <Preview
        title="Currency"
        description="Decimal.js + Intl.NumberFormat tr-TR. Her zaman tabular-nums. Emphasis KPI hero için. dimWhenZero sıfır değerler için footnote tarzı silikleştirme."
      >
        <div className="gap-sm text-muted-foreground flex flex-col font-mono text-sm">
          <div>
            <Currency value={MOCK.sampleAmount} /> (default)
          </div>
          <div>
            <Currency value={MOCK.emphasisAmount} emphasis /> (emphasis)
          </div>
          <div>
            <Currency value={0} dimWhenZero /> (zero — dimmed)
          </div>
          <div>
            <Currency value={MOCK.negativeAmount} /> (negative)
          </div>
        </div>
      </Preview>

      <Preview
        title="BadgeWithOverflow"
        description="Tek Badge + opsiyonel +N overflow chip. Karışık-status durumlarında 'birincil + N tane daha' anlatımı için. overflowCount=0 / undefined → düz Badge."
      >
        <div className="gap-md flex flex-wrap">
          <BadgeWithOverflow tone="success">Aktif</BadgeWithOverflow>
          <BadgeWithOverflow tone="success" overflowCount={2}>
            Aktif
          </BadgeWithOverflow>
          <BadgeWithOverflow tone="warning" overflowCount={5}>
            Eksik maliyet
          </BadgeWithOverflow>
          <BadgeWithOverflow tone="destructive" overflowCount={1}>
            Engellenmiş
          </BadgeWithOverflow>
          <BadgeWithOverflow tone="outline">Pasif</BadgeWithOverflow>
        </div>
      </Preview>

      <Preview
        title="MarketplaceLogo"
        description="Vendor brand wordmark — `public/brands/<platform>.svg` üzerinden. SVG unoptimized teslim ediliyor (next/image güvenlik gereği SVG optimize etmiyor). Sembolün doğal en-boy oranı w-auto ile korunuyor."
      >
        <div className="gap-lg flex flex-wrap items-end">
          {(['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((size) => (
            <div key={size} className="gap-3xs flex flex-col items-center">
              <MarketplaceLogo platform="TRENDYOL" size={size} alt="Trendyol" />
              <span className="text-2xs text-muted-foreground font-mono">size={size}</span>
            </div>
          ))}
        </div>
        <div className="gap-lg pt-md flex flex-wrap items-center">
          <MarketplaceLogo platform="TRENDYOL" size="lg" alt="Trendyol" />
          <MarketplaceLogo platform="HEPSIBURADA" size="lg" alt="Hepsiburada" />
        </div>
      </Preview>

      <Preview
        title="EmptyState"
        description="Tablo / liste yerine 'henüz veri yok' anlatan kalıp. Her zaman bir sonraki adımı (import, sync, connect) önerir — eylemsiz boş durum yasak."
      >
        <div className="gap-lg grid sm:grid-cols-2">
          <EmptyState
            icon={ShoppingBag01Icon}
            title="Henüz sipariş yok"
            description="Mağaza bağlandıktan sonra siparişler otomatik senkronize edilir."
            action={<Button size="sm">Mağaza bağla</Button>}
          />
          <EmptyState
            icon={DatabaseIcon}
            title="Seçili döneme ait kayıt bulunamadı"
            description="Tarih aralığını genişletmeyi veya filtreleri temizlemeyi dene."
            action={
              <Button variant="outline" size="sm">
                Filtreleri temizle
              </Button>
            }
          />
        </div>
      </Preview>
    </>
  );
}
