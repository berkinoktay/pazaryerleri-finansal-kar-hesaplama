import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Link } from '@/i18n/navigation';

import { ChartBarShowcase, ChartBarStackedShowcase } from '../chart-bar-showcase';
import { ComboChartMarketplaceShowcase, ComboChartShowcase } from '../chart-combo-showcase';
import { ChartLineMetricShowcase, ChartLineShowcase } from '../chart-line-showcase';
import { ChartDonutShareShowcase, ChartDonutShowcase } from '../chart-donut-showcase';
import { ChartRankingShowcase } from '../chart-ranking-showcase';

export default function ChartsPatternsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Grafikler"
        intent="PazarSync grafik kiti — tek ChartFrame kabuğu, shape-isimli reusable grafikler, dinamik kâr/zarar rengi, loading/empty/error durumları. Renk modu (semantic · brand · categorical) artık her arketipin kartında bir kontrol şeridi — eski 'her colorMode için ayrı blok' tekrarının yerini alır. Kart yalın kalır; ilişkili KPI'lar grafiğin yanında ayrı StatCard'lar olarak dizilir (sayfa seviyesinde)."
      />
      <CategoryNav section="patterns" />

      <p className="text-2xs text-muted-foreground">
        {
          'Bu kit, ham recharts primitive katmanının üzerine kurulur (ChartContainer + token-aware tooltip/legend). Ham eksen/grid/tooltip iskeletini ham recharts ile görmek için '
        }
        <Link href="/design/primitives/chart" className="text-foreground underline">
          /design/primitives/chart
        </Link>{' '}
        sayfasına bakın.
      </p>

      <ShowcaseSection
        title="LineChart"
        description="Süreklilik arketipi (zaman). colorMode kontrolünü çevir: semantic = sıfırda böl + kâr/zarar rengi + canlı-uç nabzı + 'Dün karşılaştır' açılır; brand/categorical = nötr metrik (sipariş adedi), tek çizgi, sıfır-böl yok. Durum + dönem kart-içi canlı."
      >
        <Preview
          title="LineChart — dinamik kâr/zarar + colorMode + Dün karşılaştırması"
          description="colorMode='semantic' (varsayılan): sıfırda böl, kâr yeşil / zarar kırmızı, dashed gridline, canlı-uç nabız noktası; 'Dün ile karşılaştır'ı aç → kesik+nötr gri ikincil seri + header'da delta/bağlam/legend. colorMode'u brand/categorical'a çevir → aynı bileşen nötr bir metrik (sipariş adedi) için yeniden kullanılır (sıfır-böl yok). Durum (Dolu/Yükleniyor/Boş/Hata) ve dönemi dene."
        >
          <ChartLineShowcase />
        </Preview>

        <Preview
          title="LineChart — metric switcher (tek kart, çok metrik)"
          description="Header'da Net Kâr / Ciro / Sipariş tab'ları (ChartFrame metricTabs) — tıklayınca değer + grafik serisi + renk modu değişir. Net Kâr P&L (semantic), Ciro/Sipariş nötr (brand). Tab'ları dene."
        >
          <ChartLineMetricShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="BarChart"
        description="Ayrık-kategori arketipi (dikey kolon). colorMode kontrolü: semantic = her bar kendi işaretine göre + 'Geçen hafta karşılaştır'; brand/categorical = kategori kırılımı (tek renk / nitel palet). Yığılmış kompozisyon ayrı bir yapısal demo."
      >
        <Preview
          title="BarChart — günlük net kâr + colorMode + karşılaştırma"
          description="colorMode='semantic' (varsayılan): her bar KENDİ işaretine göre — kâr günü yeşil, zarar günü kırmızı; yuvarlak cap değer ucunda, dashed grid + sıfır baseline. 'Geçen haftayla karşılaştır'ı aç → gruplu soluk bar + header'da delta/bağlam/legend. colorMode'u brand/categorical'a çevir → kategori kırılımı (tek marka rengi / nitel palet, P&L değil). Durum + dönem de var."
        >
          <ChartBarShowcase />
        </Preview>

        <Preview
          title="BarChart — yığılmış kompozisyon (stacked) + legend"
          description="series bir DİZİ → segmentler tek BİRLEŞİK bar olarak yığılır (boşluksuz, dış köşeler yuvarlak), nitel palet + altta legend (renk → seri). Kompozisyon için: gelir = net kâr + komisyon + kargo. Bar'ın üstüne gel, tooltip tüm parçaları gösterir."
        >
          <ChartBarStackedShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="RankingChart"
        description="'Hangisi kazanıyor' arketipi — kalın yatay barlar, içerik-yükseklikli liste (recharts değil, CSS). colorMode + etiket yerleşimi + durumlar tek kontrol şeridinde; semantic'e geçince veri seti işaretli ürün P&L'ine döner (sıfır ayıracı belirir)."
      >
        <Preview
          title="RankingChart — colorMode + etiket modu + durumlar"
          description="colorMode='brand' (varsayılan): en kârlı kategoriler, tek renk, sıralamayı UZUNLUK taşır (değer kolonu + x-ekseni). 'semantic'e çevir → işaretli ürün kâr/zarar veri seti: zarar satırları SIFIR AYIRACININ soluna (kırmızı), kârlılar sağa (yeşil). 'categorical' → pazaryeri cirosu kırılımı (nitel palet). 'Etiket dışarıda/içeride' toggle'ı etiketi sol gutter'a vs. barın İÇİNE taşır. Durum → içerik-yükseklikli satır skeleton'ı."
        >
          <ChartRankingShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="DonutChart"
        description="İlk Cartesian-OLMAYAN tip (recharts Pie). Halka: nitel palet dilimler, MERKEZDE toplam + alt-başlık, sağda legend (renk · etiket · değer · %). Tek mağaza ya da birleşik kaynak footer'ı."
      >
        <Preview
          title="DonutChart — gider dağılımı (pay) + durumlar"
          description="Halka: nitel palet dilimler (yuvarlak cap + paddingAngle), MERKEZDE toplam + alt-başlık; sağda legend (renk · etiket · değer · %). Dilim üstüne gel → tooltip (etiket · değer · %). Durum (Dolu/Yükleniyor/Boş/Hata) → dairesel skeleton + boş halka."
        >
          <ChartDonutShowcase />
        </Preview>

        <Preview
          title="DonutChart — pazaryeri payı (combined kaynak)"
          description="Pazaryerlerine göre ciro payı. Footer kaynağı combined (Trendyol + Hepsiburada mağazaları → logo'lar + 'N mağaza')."
        >
          <ChartDonutShareShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="ComboChart"
        description="'Tutar vs. oran' arketipi — barlar SOL ₺ ekseninde, çizgi SAĞ % ekseninde. İki ölçek tek frame'de. Tekil ya da gruplu bar serisi + marj çizgisi."
      >
        <Preview
          title="ComboChart — ciro (bar) + marj % (çizgi), çift eksen + durumlar"
          description="Tutar vs. oran arketipi: barlar SOL ₺ ekseninde (ciro), çizgi SAĞ % ekseninde (marj). İki ölçek, ₺ binlerin %'lik çizgiyi ezmemesi için. Barlar paylaşılan ChartBar şeklini kullanır (serbest uç yuvarlak), çizgi üstte; altta legend renk→seri. Tooltip çok-satır kart (her satır kendi formatıyla: ₺ bar, % çizgi). Durum (Dolu/Yükleniyor/Boş/Hata) → combo skeleton (kolon + çizgi)."
        >
          <ComboChartShowcase />
        </Preview>

        <Preview
          title="ComboChart — pazaryeri cirosu (gruplu bar) + marj (combined kaynak)"
          description="İki bar serisi (Trendyol + Hepsiburada ciro, sol eksende gruplu) + sağ eksende marj çizgisi. Gruplu bar + çizgi + combined footer kaynağını birlikte gösterir."
        >
          <ComboChartMarketplaceShowcase />
        </Preview>
      </ShowcaseSection>
    </>
  );
}
