'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DateInput } from '@/components/patterns/date-input';
import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';

import { ComboboxShowcase } from '../combobox-showcase';
import { FileUploadShowcase } from '../file-upload-showcase';
import { InlineEditShowcase } from '../inline-edit-showcase';
import { MoneyInputShowcase } from '../money-input-showcase';
import { MultiFileUploadShowcase } from '../multi-file-upload-showcase';
import { PercentageInputShowcase } from '../percentage-input-showcase';
import { SearchInputShowcase } from '../search-input-showcase';

export default function FormsPatternsPage(): React.ReactElement {
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: new Date('2026-04-01T00:00:00Z'),
    to: new Date('2026-04-30T00:00:00Z'),
  });
  const [invoiceDate, setInvoiceDate] = React.useState<Date | null>(
    new Date('2026-04-15T00:00:00Z'),
  );
  const [dueDate, setDueDate] = React.useState<Date | null>(null);

  return (
    <>
      <PageHeader
        title="Form girdisi pattern'ları"
        intent="Veri girişi: TRY tutar, yüzde, arama, tarih aralığı. Hepsi Decimal / Date kontratıyla, locale-aware. Tutar/yüzde/arama config prop'ları Playground şeritlerinden canlı çevrilir; değeri sen yazarsın."
      />
      <CategoryNav section="patterns" />

      <ShowcaseSection
        title="Sayısal girdi — MoneyInput & PercentageInput"
        description="Aynı tr-TR parser + Decimal çıktı kontratı; MoneyInput ₺ leading slot, PercentageInput % leading slot. Boş alan null'a çözülür. Config prop'ları (scale/nonNegative/invalid/symbol) Playground'da; değeri kendin yaz."
      >
        <MoneyInputShowcase />
        <PercentageInputShowcase />
      </ShowcaseSection>

      <ShowcaseSection
        title="Arama & seçim"
        description="SearchInput konvansiyon wrapper'ı (Search ikonu + onClear + lokalize placeholder); Combobox searchable single-select (Popover + Command + Button); InlineEdit tıkla-düzenle pattern'ı."
      >
        <SearchInputShowcase />

        <Preview
          title="Combobox"
          description="Searchable single-select. shadcn'in recipe'ini Popover + Command + Button olarak tek bir API'ye sarıyor — kategori, marka, mağaza picker'ları için. Opsiyon başına icon + description; disabled satır; loading spinner; invalid border. Kısa sabit liste için Select; 2-7 görünür opsiyon için RadioGroup. Aç → 'ara' yaz, disabled satırı seçmeyi dene; loading/invalid kolonlarını incele."
        >
          <ComboboxShowcase />
        </Preview>

        <Preview
          title="InlineEdit"
          description="Tıkla-düzenle pattern'ı. Modal yerine bağlam korunur. Generic value/onCommit + opsiyonel renderDisplay (Currency, formatted span) + renderEdit (MoneyInput, PercentageInput vs.). Üzerine gel → düzenle ikonu; tıkla → input; Enter commit, Esc iptal, blur=commit (commitOnBlur=false ile cancel)."
        >
          <InlineEditShowcase />
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Tarih girdisi"
        description="Tek tarih için DateInput, aralık için DateRangePicker — trigger geometrisi ortak (outline buton + Calendar01Icon + tr-TR formatlı label) ki yan yana kullanıldığında görsel tutarlılık bozulmasın. Seçim tamamlanınca popover kendi kapanır."
      >
        <Preview
          title="DateInput"
          description="Tek tarih seçimi — DateRangePicker'ın kardeşi. Boş başlatılınca lokalize placeholder gösterilir; tarih seçilince popover kendi kapanır."
        >
          <div className="gap-md grid sm:grid-cols-2">
            <div className="gap-3xs flex flex-col items-start">
              <span className="text-2xs text-muted-foreground font-medium">Fatura tarihi</span>
              <DateInput value={invoiceDate} onChange={setInvoiceDate} />
              <span className="text-2xs text-muted-foreground tabular-nums">
                ISO: {invoiceDate ? invoiceDate.toISOString().split('T')[0] : '— (boş)'}
              </span>
            </div>
            <div className="gap-3xs flex flex-col items-start">
              <span className="text-2xs text-muted-foreground font-medium">Vade tarihi (boş)</span>
              <DateInput value={dueDate} onChange={setDueDate} />
              <span className="text-2xs text-muted-foreground">
                Boş başlatıldı; lokalize placeholder gösterilir.
              </span>
            </div>
          </div>
        </Preview>

        <Preview
          title="DateRangePicker"
          description="Popover içinde Calendar (mode='range', tr-TR locale, 2 ay yan yana). Trigger outline buton — Input gibi durur. Range tamamlandığında popover kendi kapanır. Tek tarih için DateInput kullan."
        >
          <div className="gap-3xs flex flex-col items-start">
            <DateRangePicker value={range} onChange={setRange} />
            <span className="text-2xs text-muted-foreground">
              Seçim: {range?.from?.toISOString().split('T')[0] ?? '—'} →{' '}
              {range?.to?.toISOString().split('T')[0] ?? '—'}
            </span>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Dosya yükleme"
        description="Tek dosya için FileUpload, çoklu batch için MultiFileUpload. Tıkla → file picker, sürükle-bırak → drop zone. accept + maxSize lokal validasyon; image/* otomatik thumbnail. Gerçek dosya seç / kaldır / state değişimini canlı izle."
      >
        <Preview
          title="FileUpload"
          description="Tek dosya dropzone. Tıkla → file picker; sürükle-bırak → drop zone. accept (MIME / extension) + maxSize lokal validasyon; error prop server-side hata için. Dolu state'te kompakt dosya satırı (MIME-aware icon: csv / image / audio / video / generic). image/* otomatik thumbnail önizlemesi (URL.createObjectURL, unmount'ta revoke). progress=0-100 belirli ilerleme barı; loading=true belirsiz spinner. Settlement CSV / ürün görseli için."
        >
          <FileUploadShowcase />
        </Preview>

        <Preview
          title="MultiFileUpload"
          description="Çoklu dosya — boş state aynı dropzone, dolu state üstte başlık satırı (Dosyalar (N) · Dosya ekle · Tümünü kaldır) ve per-file row listesi. Per-file progress bar Record<index, 0-100> ile callsite-driven. maxFiles cap'i + accept + maxSize her dosya için validate edilir. Ürün görseli batch upload, hakediş ek dosyaları için."
        >
          <MultiFileUploadShowcase />
        </Preview>
      </ShowcaseSection>
    </>
  );
}
