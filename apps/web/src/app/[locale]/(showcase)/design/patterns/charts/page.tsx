import { PageHeader } from '@/components/patterns/page-header';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Preview } from '@/components/showcase/preview';

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
    </>
  );
}
