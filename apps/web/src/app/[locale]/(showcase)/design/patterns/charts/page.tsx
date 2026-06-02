import { PageHeader } from '@/components/patterns/page-header';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Preview } from '@/components/showcase/preview';

import {
  ChartBarBrandShowcase,
  ChartBarCategoricalShowcase,
  ChartBarShowcase,
  ChartBarStackedShowcase,
} from '../chart-bar-showcase';
import {
  ChartLineBrandShowcase,
  ChartLineMetricShowcase,
  ChartLineShowcase,
} from '../chart-line-showcase';

export default function ChartsPatternsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Grafikler"
        intent="PazarSync grafik kiti — tek ChartFrame kabuğu, shape-isimli reusable grafikler (LineChart), dinamik kâr/zarar rengi, loading/empty/error durumları. Kart yalın kalır; ilişkili KPI'lar grafiğin yanında ayrı KpiTile'lar olarak dizilir (sayfa seviyesinde)."
      />
      <PatternNav />

      <Preview
        title="LineChart — dinamik kâr/zarar + Dün karşılaştırması"
        description="colorMode='semantic' (varsayılan): sıfırda böl, kâr yeşil / zarar kırmızı. Dashed gridline, canlı-uç nabız noktası. 'Dün ile karşılaştır'ı aç — kesik+nötr gri ikincil seri + header'da delta/bağlam/legend belirir (asıl seriyle karışmaz). Durum (Dolu/Yükleniyor/Boş/Hata) ve dönem seçicisini dene."
      >
        <ChartLineShowcase />
      </Preview>

      <Preview
        title="LineChart — metric switcher (tek kart, çok metrik)"
        description="Header'da Net Kâr / Ciro / Sipariş tab'ları (ChartFrame metricTabs) — tıklayınca değer + grafik serisi + renk modu değişir. Net Kâr P&L (semantic), Ciro/Sipariş nötr (brand). Tab'ları dene."
      >
        <ChartLineMetricShowcase />
      </Preview>

      <Preview
        title="LineChart — brand modu (nötr metrik)"
        description="Aynı bileşen, colorMode='brand': sıfır-böl yok, tek marka çizgisi. P&L olmayan metrikler (sipariş adedi, senkron hacmi) için LineChart'ı yeniden kullanmayı gösterir."
      >
        <ChartLineBrandShowcase />
      </Preview>

      <Preview
        title="BarChart — günlük net kâr (semantic) + karşılaştırma"
        description="colorMode='semantic' (varsayılan): her bar KENDİ işaretine göre — kâr günü yeşil, zarar günü kırmızı; yuvarlak cap değer ucunda. Dashed grid + sıfır baseline. 'Geçen haftayla karşılaştır'ı aç → gruplu soluk bar + header'da delta/bağlam/legend. Durum + dönem de var."
      >
        <ChartBarShowcase />
      </Preview>

      <Preview
        title="BarChart — yığılmış kompozisyon (stacked) + legend"
        description="series bir DİZİ → segmentler tek BİRLEŞİK bar olarak yığılır (boşluksuz, dış köşeler yuvarlak), nitel palet + altta legend (renk → seri). Kompozisyon için: gelir = net kâr + komisyon + kargo. Bar'ın üstüne gel, tooltip tüm parçaları gösterir."
      >
        <ChartBarStackedShowcase />
      </Preview>

      <Preview
        title="BarChart — kategori kırılımı (categorical)"
        description="colorMode='categorical': her bar nitel paletten (--chart-1..6) bir renk. Kategori/pazaryeri kırılımları için. P&L değil, kırılım."
      >
        <ChartBarCategoricalShowcase />
      </Preview>

      <Preview
        title="BarChart — brand modu (nötr metrik)"
        description="colorMode='brand': tek marka rengi barlar. Sipariş adedi gibi +/- anlamı olmayan metrikler için."
      >
        <ChartBarBrandShowcase />
      </Preview>
    </>
  );
}
