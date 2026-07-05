'use client';

import Decimal from 'decimal.js';
import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  DatabaseIcon,
  ShoppingBag01Icon,
} from 'hugeicons-react';

import { BadgeWithOverflow } from '@/components/patterns/badge-with-overflow';
import { Currency } from '@/components/patterns/currency';
import { EmptyState } from '@/components/patterns/empty-state';
import { MappedBadge } from '@/components/patterns/mapped-badge';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { StatRow } from '@/components/patterns/stat-row';
import { StatStrip, type StatStripItem } from '@/components/patterns/stat-strip';

import { DefinitionListShowcase } from '../definition-list-showcase';
import { ImageCellShowcase } from '../image-cell-showcase';
import { ProfitCellShowcase } from '../profit-cell-showcase';
import { SparklineShowcase } from '../sparkline-showcase';
import {
  InfoHintShowcase,
  StatCardChartKitShowcase,
  StatCardRichShowcase,
  StatCardStatesShowcase,
  StatCardTilesShowcase,
  StatStripLoadingShowcase,
  StatStripShowcase,
} from '../stat-card-showcase';
import { TimeAgoShowcase } from '../time-ago-showcase';
import { PageHeader } from '@/components/patterns/page-header';
import { TrendDelta } from '@/components/patterns/trend-delta';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { Link } from '@/i18n/navigation';

const MOCK = {
  sampleAmount: new Decimal('1284.39'),
  emphasisAmount: new Decimal('48120.80'),
  negativeAmount: new Decimal('-248.15'),
};

const MARKETPLACE_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

const STAT_STRIP_SIZE_ITEMS: StatStripItem[] = [
  { label: 'Toplam Ciro', value: '₺284.750,00' },
  { label: 'Net Kâr', value: '₺52.180,40' },
  { label: 'Ortalama Marj', value: '%18,3' },
  { label: 'Zarar Eden Sipariş', value: '%4,2', context: '62 / 1.472 sipariş' },
];

export default function DisplayPatternsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Görsel & sayısal pattern'lar"
        intent="Veri-okuma yüzeyleri: stat/KPI, sayı/yüzde delta, currency, trend microchart, görsel hücre, liste, boş durum. Prop-matrisli pattern'lar tek bir Playground'a indirgendi — kontrolleri çevirerek canlı gör; davranış (in-context kompozisyon, async, boş seri) ayrı Preview'larda."
      />
      <CategoryNav section="patterns" />

      <ShowcaseSection
        title="Stat & KPI"
        description="Slot-tabanlı StatCard ailesi + StatStrip + InfoHint. Aynı bileşen farklı dizilişlerde; durumlar (loading / empty / error) ve drill-down kart içinde yaşar."
      >
        <Preview
          title="StatStrip — segmented KPI özeti"
          description="Tek hairline konteyner, ince ayraçlar; her hücre başlık (+ opsiyonel ⓘ) + sağ-üst dairesel outline ikon + büyük değer + dönem + delta pill. Sayfa başı özet bandı — mobilde stacked (border-t), lg'de tek satır (border-l). Ciro ve Net Kâr'ın ⓘ'sine gel."
        >
          <StatStripShowcase />
        </Preview>

        <Preview
          title="StatStrip — loading"
          description="Aynı item konfigürasyonu, `loading` ile: gerçek başlıklar ve ikonlar kalır, yalnız değer + bağlam satırı iskelete döner — sayı gelince hiçbir şey zıplamaz, sahte sıfır da parlamaz. Etiketleri henüz bilinmeyen rota-düzeyi yer tutucular için `StatStripSkeleton` / `PageSkeleton` var."
        >
          <StatStripLoadingShowcase />
        </Preview>

        <Preview
          title="Bare yüzey (çerçeve içinde)"
          description="Kartsız yüzey: çerçeveli PageHeader'ın summary yuvasına dokmak için — yüzeyi ve giriş animasyonunu dış çerçeve taşır."
        >
          <StatStrip surface="bare" size="md" items={STAT_STRIP_SIZE_ITEMS} />
        </Preview>

        <Preview
          title="Boyut adımları"
          description="Yalnız değer satırı ölçeklenir (20/24/30px); etiket ve bağlam satırları sabittir."
        >
          <div className="gap-lg flex flex-col">
            <StatStrip size="sm" items={STAT_STRIP_SIZE_ITEMS} />
            <StatStrip size="md" items={STAT_STRIP_SIZE_ITEMS} />
            <StatStrip size="lg" items={STAT_STRIP_SIZE_ITEMS} />
          </div>
        </Preview>

        <Preview
          title="StatCard — icon-hero · metrik+trend · aksiyon"
          description="Aynı slot-tabanlı StatCard üç dizilişte: dairesel soft ikon + değer + delta/dönem; değer + (mutlak + pill) + sağda mini-bar trend (Sparkline variant='bars'); emphasis başlık + trailing ikon + 'Raporu gör →' CTA."
        >
          <StatCardTilesShowcase />
        </Preview>

        <Preview
          title="StatCard — breakdown (DistributionBar) + çok-metrik hero"
          description="Breakdown: hero değer + (pill + mutlak + dönem) + stacked dağılım barı + legend (ChartSwatch · etiket · değer · %), DistributionBar children olarak. Çok-metrik hero: kompozisyon (yeni bileşen değil) — iki metrik + area trend."
        >
          <StatCardRichShowcase />
        </Preview>

        <Preview
          title="StatCard + GERÇEK chart kit (DonutChart / BarChart)"
          description="Slot'lar (trend/children) düz ReactNode — hiçbir grafik kartın içine gömülü değil. Burada children'a kit'in GERÇEK recharts bileşenleri konuyor: solda DonutChart (dağılım — DistributionBar yerine), sağda BarChart (aylık ciro). Gerçek sayfada recharts'ın daha iyi yönettiği yerde kendi chart kit'ini bu kartlara koyabilirsin; taşma/bozulma kontrolü için sabit-yükseklik konteynerde."
        >
          <StatCardChartKitShowcase />
        </Preview>

        <Preview
          title="StatCard — durumlar + drill-down"
          description="status='loading' shape-duyarlı skeleton, 'empty' → —, 'error' → yeniden-dene; toggle'ı dene. İkinci kart href ile tüm-kart drill-down (stretched-link + hover lift); ⓘ butonu drill-down'u tetiklemez."
        >
          <StatCardStatesShowcase />
        </Preview>

        <Preview
          title="InfoHint — açıklama tooltip'i (genel atom)"
          description="Etiketin yanına opsiyonel ⓘ + hover/focus tooltip (PazarSync Tooltip: bg-card · hairline · shadow · portala taşınır). Sadece stat'lara değil, her etiket/başlık yanına. Üstüne gel ya da Tab'la odaklan."
        >
          <InfoHintShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Delta & para"
        description="Yüzde delta chip'i, currency formatı ve ikisinin tablo hücresindeki kompozisyonu (ProfitCell)."
      >
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

        <ProfitCellShowcase />
      </ShowcaseSection>

      <ShowcaseSection
        title="Badge'ler"
        description="Tek Badge + opsiyonel +N overflow chip, ve generic enum→tone+label eşlemesi. Atom Badge kanonik olarak /design/primitives/buttons sayfasında yaşar."
      >
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
            <BadgeWithOverflow variant="outline">Pasif</BadgeWithOverflow>
          </div>
        </Preview>

        <Preview
          title="MappedBadge"
          description="Generic enum→tone+label badge. toneMap + labelMap Record'larıyla static mapping; overflowCount BadgeWithOverflow'a delege edilir. Variant status, payout durumu gibi static enum'lar için. Koşullu mapping (durationDays + isRush gibi) için BadgeWithOverflow'a doğrudan in."
        >
          <div className="gap-md flex flex-wrap">
            <MappedBadge<'onSale' | 'archived' | 'locked' | 'blacklisted' | 'inactive'>
              value="onSale"
              toneMap={{
                onSale: 'success',
                archived: 'neutral',
                locked: 'warning',
                blacklisted: 'destructive',
                inactive: 'neutral',
              }}
              variantMap={{ inactive: 'outline' }}
              labelMap={{
                onSale: 'Satışta',
                archived: 'Arşiv',
                locked: 'Kilitli',
                blacklisted: 'Engellenmiş',
                inactive: 'Pasif',
              }}
            />
            <MappedBadge<'onSale' | 'archived' | 'locked' | 'blacklisted' | 'inactive'>
              value="locked"
              toneMap={{
                onSale: 'success',
                archived: 'neutral',
                locked: 'warning',
                blacklisted: 'destructive',
                inactive: 'neutral',
              }}
              variantMap={{ inactive: 'outline' }}
              labelMap={{
                onSale: 'Satışta',
                archived: 'Arşiv',
                locked: 'Kilitli',
                blacklisted: 'Engellenmiş',
                inactive: 'Pasif',
              }}
              overflowCount={3}
            />
            <MappedBadge<'paid' | 'pending' | 'overdue' | 'failed'>
              value="overdue"
              toneMap={{
                paid: 'success',
                pending: 'info',
                overdue: 'warning',
                failed: 'destructive',
              }}
              labelMap={{
                paid: 'Ödendi',
                pending: 'Beklemede',
                overdue: 'Gecikmiş',
                failed: 'Başarısız',
              }}
            />
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Trend & görsel"
        description="Inline trend microchart (Sparkline), sabit-footprint görsel hücre (ImageCell) ve pazaryeri marka işareti."
      >
        <SparklineShowcase />

        <ImageCellShowcase />

        <Playground
          title="MarketplaceLogo — platform · size"
          description="public/brands/<platform>.svg üzerinden vendor-doğru renk (Trendyol turuncu, Hepsiburada kırmızı) korunur. SVG unoptimized teslim edilir. Yükseklik size ile; genişlik w-auto ile doğal en-boy oranını korur."
          controls={{
            platform: control.segment(['TRENDYOL', 'HEPSIBURADA'], 'TRENDYOL'),
            size: control.select(MARKETPLACE_SIZES, 'lg'),
          }}
          render={(v) => <MarketplaceLogo platform={v.platform} size={v.size} alt={v.platform} />}
        />
      </ShowcaseSection>

      <ShowcaseSection
        title="Liste & zaman"
        description="Semantik <dl> key→value listesi ve relative zaman atomu."
      >
        <DefinitionListShowcase />

        <Preview
          title="TimeAgo"
          description="Geçmiş tarih için relative label (&quot;2 dk önce&quot;) + tooltip'te tam zaman + opsiyonel timezone. SSR-safe: ilk paint deterministic absolute date, mount sonrası relative'e döner. SyncBadge / NotificationBell / ActivityFeed bu atomu paylaşacak."
        >
          <TimeAgoShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Boş durum & satır"
        description="Eylem öneren boş-durum kalıbı ve Card içinde yüzmeyen nested aksiyon satırı. Tablo gövde durumları (first-run / no-results / error) DataTable'a aittir."
      >
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

        <p className="text-2xs text-muted-foreground">
          DataTable gövde durumları (first-run · no-results · error) kanonik olarak{' '}
          <Link href="/design/data" className="underline underline-offset-2">
            /design/data
          </Link>{' '}
          sayfasında yaşar.
        </p>

        <Preview
          title="StatRow"
          description="Düz bir Card'ı yükselmeden zengin gösteren nested aksiyon satırı: surface-subtle şerit + SoftSquareIcon + iki-satır etiket (başlık + tonlu status) + chevron. Gölgesiz (nested oturur, yüzmez) — Card-ailesi shadow dili korunur. Sunumsal; gerçek gezinme için bir Link/button ile sarılır."
        >
          <div className="gap-lg grid sm:grid-cols-2">
            <Card className="gap-md p-lg flex flex-col">
              <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
                Bu ay net kâr
              </span>
              <span className="text-foreground text-4xl font-semibold tracking-tight tabular-nums">
                ₺512.800
              </span>
              <StatRow
                interactive
                icon={
                  <SoftSquareIcon tone="success">
                    <CheckmarkCircle02Icon />
                  </SoftSquareIcon>
                }
                title="6/6 mağaza"
                meta="Güncel"
                metaTone="success"
              />
            </Card>
            <Card className="gap-md p-lg flex flex-col">
              <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
                Bekleyen tahsilat
              </span>
              <span className="text-foreground text-4xl font-semibold tracking-tight tabular-nums">
                ₺74.120
              </span>
              <StatRow
                interactive
                icon={
                  <SoftSquareIcon tone="destructive">
                    <AlertCircleIcon />
                  </SoftSquareIcon>
                }
                title="1/6 mağaza"
                meta="Riskli"
                metaTone="destructive"
              />
            </Card>
          </div>
          <div className="gap-sm pt-md flex flex-col">
            <StatRow
              interactive
              icon={
                <SoftSquareIcon tone="warning">
                  <Alert02Icon />
                </SoftSquareIcon>
              }
              title="3/6 mağaza maliyeti eksik"
              meta="İzlemede"
              metaTone="warning"
            />
            <StatRow
              icon={
                <SoftSquareIcon tone="neutral" variant="soft">
                  <DatabaseIcon />
                </SoftSquareIcon>
              }
              title="Son senkron 4 sa önce"
              meta="Trendyol · 1.284 sipariş"
            />
          </div>
        </Preview>
      </ShowcaseSection>
    </>
  );
}
