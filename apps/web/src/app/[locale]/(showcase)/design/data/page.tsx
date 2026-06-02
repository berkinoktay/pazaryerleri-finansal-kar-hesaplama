'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';

import { AdvancedFilterShowcase } from '../patterns/advanced-filter-showcase';
import { BulkActionBarShowcase } from '../patterns/bulk-action-bar-showcase';
import { DataTableExpandableRowsShowcase } from '../patterns/data-table-expandable-rows-showcase';
import { DataTablePaginationShowcase } from '../patterns/data-table-pagination-showcase';
import { DataTablePinningShowcase } from '../patterns/data-table-pinning-showcase';
import { DataTableRowClickShowcase } from '../patterns/data-table-row-click-showcase';
import { DataTableServerModeShowcase } from '../patterns/data-table-server-mode-showcase';
import { DataTableStatesShowcase } from '../patterns/data-table-states-showcase';
import { DataTableSubrowsShowcase } from '../patterns/data-table-subrows-showcase';
import { FilterChipGroupShowcase } from '../patterns/filter-chip-group-showcase';
import { FilterTabsShowcase } from '../patterns/filter-tabs-showcase';
import { buildOrderColumns, buildShowcaseRows } from '../patterns/showcase-table';

// The canonical 8-column MockOrder set, composed from the shared fixture every
// data-table-* demo also draws from (select left, then identity / status /
// money columns).
const columns = buildOrderColumns([
  'select',
  'orderNumber',
  'customer',
  'platform',
  'status',
  'grossAmount',
  'commissionAmount',
  'netProfit',
]);

export default function DataShowcasePage(): React.ReactElement {
  // Mock data is stable for the page's lifetime — useMemo (not useState) so the
  // page component holds NO mutable state and never re-renders. Every
  // interactive demo owns its OWN state inside its showcase component, so
  // clicking an action re-renders only that demo, not the whole table-heavy
  // page (the previous page-level `loading` state re-rendered every table at
  // once and hung the tab).
  const rows = React.useMemo(() => buildShowcaseRows(50), []);

  return (
    <>
      <PageHeader
        title="Veri tablosu"
        intent="TanStack Table v8 üstüne oturtulmuş DataTable wrapper'ı ve çevresindeki toolbar / filtre pattern'leri. En sık kullanılandan ileri senaryolara doğru sıralı."
      />
      <CategoryNav section="patterns" />

      <ShowcaseSection
        title="Temel tablo"
        description="Sıralama, seçim, toolbar ve sayfalamanın bir arada çalıştığı tam örnek — çoğu özelliği tek tabloda gör."
      >
        <Preview
          title="Canlı tablo"
          description="Başlık tıkla & sırala · satır seç · kolon gizle/göster · sayfalar arası gez. Toolbar arama + filtre + içe/dışa aktarım emit eder."
        >
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            enableRowSelection
            toolbar={(table) => (
              <DataTableToolbar
                table={table}
                searchColumn="customer"
                searchPlaceholder="Müşteri ara..."
                onImport={() => toast.info('Import diyaloğu burada açılır')}
                onExport={(selected) =>
                  toast.success(`${selected.length} kayıt dışa aktarıldı (mock)`)
                }
              />
            )}
            pagination={(table) => <DataTablePagination table={table} />}
          />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Durumlar"
        description="Gövde tek bir öncelik merdivenine indirgenir: loading → error → (filtreliyse no-results : first-run) → satırlar. Her durumun ayrı ikonu, copy'si ve eylemi var; hepsi aynı yükseklikte (min-h-table-empty) olduğu için geçişlerde zıplama olmaz."
      >
        <Preview
          title="Dört durum — tek tabloda geçiş yap"
          description="Segmenti değiştir: Yükleniyor (skeleton) · İlk kurulum (inbox + senkron) · Sonuç yok (filtre-kapalı + Filtreleri temizle) · Hata (uyarı + Tekrar dene) · Dolu. State izole — sayfayı çökertmez."
        >
          <DataTableStatesShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Sütun & satır davranışları"
        description="Pinli kolonlar, satıra tıklama, inline genişleyen detay paneli ve hiyerarşik alt satırlar."
      >
        <Preview
          title="Sütun sabitleme & yatay scroll"
          description="Pinli kolonlar yatay kaydırmada yerinde kalır; pin-edge gölgesi yalnızca kayan içerik pinin altına girince, scroll konumuna duyarlı belirir. `select` sola, `actions` sağa otomatik sabitlenir."
        >
          <DataTablePinningShowcase />
        </Preview>

        <Preview
          title="Satır tıklama (onRowClick)"
          description="Satıra tıkla → handler; ama checkbox / button / link gibi interaktif alt öğeler tıklamayı yutmaz. `data-row-action` ile custom opt-out."
        >
          <DataTableRowClickShowcase />
        </Preview>

        <Preview
          title="Genişleyebilen satırlar (renderSubComponent)"
          description="`getRowCanExpand` koşulunu sağlayan satırlar chevron alır; tıklayınca `renderSubComponent` altında inline genişler."
        >
          <DataTableExpandableRowsShowcase />
        </Preview>

        <Preview
          title="Alt satırlar (getSubRows)"
          description="Parent satırın child koleksiyonu aynı grid'de sibling olarak render olur; column genişlikleri hizalı, `data-depth` ile stillenir."
        >
          <DataTableSubrowsShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Sayfalama & sunucu modu"
        description="DataTablePagination client ve server modunda aynı UI'ı verir. Sorting / filtering / pagination state'i parent'a verilince DataTable hesaplamayı bırakır — manualSorting / manualFiltering / manualPagination otomatik açılır."
      >
        <Preview title="Sayfalama varyantları">
          <DataTablePaginationShowcase />
        </Preview>

        <Preview
          title="Sunucu modu — controlled sorting + filtering + pagination"
          description="Caller state'i lift eder, API'ye forward eder, gelen slice'ı `data` olarak besler. UI birebir aynı; sadece kim hesaplıyor değişir. Üstteki segment arama bağlamasını çevirir: column-filter (TanStack) vs page-level (nuqs URL query) — `searchValue` + `onSearchChange`."
        >
          <DataTableServerModeShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Toolbar, filtre & toplu işlem"
        description="Tablonun etrafındaki yardımcı pattern'ler — DataTable'ın parçası değil ama onunla birlikte kullanılır."
      >
        <FilterTabsShowcase />

        <Preview
          title="FilterChipGroup"
          description="Uygulanan additive filtreleri pill chip'leri olarak gösterir; her chip kendi X'i + opsiyonel &quot;Tümünü temizle&quot;. Per-chip leading icon."
        >
          <FilterChipGroupShowcase />
        </Preview>

        <Preview
          title="BulkActionBar"
          description='Seçili satırlar üstünde çoklu aksiyon. Simetrik giriş/çıkış animasyonu (pop yok, kayarak iner), busy (spinner + tümü disable), Escape ile temizle, dar ekranda icon-only + overflowAfter ile "Daha fazla" menüsü. Floating mod shadow-lg ile en üst katman; inline mod toolbar yerine durur.'
        >
          <BulkActionBarShowcase />
        </Preview>

        <Preview
          title="Gelişmiş filtreleme (AdvancedFilter)"
          description="Tek `+ Filtre ekle` cmdk menüsü → tip-duyarlı interaktif chip'ler (operatör seçici + değer editörü) → tümü AND ile birleşir, `Uygula` ile commit. Aralık alanları RangeInput, çoklu-seçim Command, sabit-set Select. Generic motor (`FilterFieldDef[]` ile her tabloya). Filtre 0 sonuç verince DataTable'ın no-results durumu çıkar."
        >
          <AdvancedFilterShowcase />
        </Preview>
      </ShowcaseSection>
    </>
  );
}
