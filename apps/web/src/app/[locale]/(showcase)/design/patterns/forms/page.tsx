'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DateInput } from '@/components/patterns/date-input';
import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { PatternNav } from '@/components/showcase/pattern-nav';
import { Preview } from '@/components/showcase/preview';

import { ComboboxShowcase } from '../combobox-showcase';
import { FileUploadShowcase } from '../file-upload-showcase';
import { InlineEditShowcase } from '../inline-edit-showcase';
import { MoneyInputShowcase } from '../money-input-showcase';
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
        intent="Veri girişi: TRY tutar, yüzde, arama, tarih aralığı. Hepsi Decimal / Date kontratıyla; locale-aware."
      />
      <PatternNav />

      <Preview
        title="MoneyInput"
        description="₺ leading slot + tr-TR ayrıştırma. Yazarken serbest (ara giriş '1,' korunur), Decimal'a çevrilir, Currency display ile aynı kontratı paylaşır. nonNegative, invalid, custom symbol ve scale=0 (tam TRY) destekler."
      >
        <MoneyInputShowcase />
      </Preview>

      <Preview
        title="PercentageInput"
        description="MoneyInput'un kardeşi. % leading slot — Türkçe konvansiyonu '23,64%' değil '%23,64'. Aynı tr-TR parser, Decimal output. Komisyon, vergi, marj, indirim için. Sınır YOK varsayılan — komisyon %100'ü geçebilir, marj negatif olabilir."
      >
        <PercentageInputShowcase />
      </Preview>

      <Preview
        title="SearchInput"
        description="Konvansiyon wrapper'ı: Search ikonu + onClear butonu + lokalize placeholder ('Ara…'). Üç farklı feature elle aynı üçlüyü kuruyordu — WET+1 promotion. type='search', inputMode='search' otomatik."
      >
        <SearchInputShowcase />
      </Preview>

      <Preview
        title="Combobox"
        description="Searchable single-select. shadcn'in recipe'ini Popover + Command + Button olarak tek bir API'ye sarıyor — kategori, marka, mağaza picker'ları için. Opsiyon başına icon + description; disabled satır; loading spinner; invalid border. Kısa sabit liste için Select; 2-7 görünür opsiyon için RadioGroup."
      >
        <ComboboxShowcase />
      </Preview>

      <Preview
        title="InlineEdit"
        description="Tıkla-düzenle pattern'ı. Modal yerine bağlam korunur. Generic value/onCommit + opsiyonel renderDisplay (Currency, formatted span) + renderEdit (MoneyInput, PercentageInput vs.). Enter commit, Esc iptal, blur=commit (commitOnBlur=false ile cancel)."
      >
        <InlineEditShowcase />
      </Preview>

      <Preview
        title="DateInput"
        description="Tek tarih seçimi — DateRangePicker'ın kardeşi. Trigger geometry aynı (outline buton + Calendar01Icon + tr-TR formatlı label) ki yan yana kullanıldığında görsel tutarlılık bozulmasın. Tarih seçilince popover kendi kapanır."
      >
        <div className="gap-md grid sm:grid-cols-2">
          <div className="gap-3xs flex flex-col">
            <span className="text-2xs text-muted-foreground font-medium">Fatura tarihi</span>
            <DateInput value={invoiceDate} onChange={setInvoiceDate} />
            <span className="text-2xs text-muted-foreground tabular-nums">
              ISO: {invoiceDate ? invoiceDate.toISOString().split('T')[0] : '— (boş)'}
            </span>
          </div>
          <div className="gap-3xs flex flex-col">
            <span className="text-2xs text-muted-foreground font-medium">Vade tarihi (boş)</span>
            <DateInput value={dueDate} onChange={setDueDate} />
            <span className="text-2xs text-muted-foreground">
              Boş başlatıldı; lokalize placeholder gösterilir.
            </span>
          </div>
        </div>
      </Preview>

      <Preview
        title="FileUpload"
        description="Tek dosya dropzone. Tıkla → file picker; sürükle-bırak → drop zone. accept (MIME / extension) + maxSize lokal validasyon; error prop server-side hata için. Dolu state'te kompakt dosya satırı (icon + isim + boyut + remove). Settlement CSV import'u için tasarlandı; multi-file için ayrı bir MultiFileUpload yaz."
      >
        <FileUploadShowcase />
      </Preview>

      <Preview
        title="DateRangePicker"
        description="Popover içinde Calendar (mode='range', tr-TR locale, 2 ay yan yana). Trigger outline buton — Input gibi durur. Range tamamlandığında popover kendi kapanır. Tek tarih için DateInput kullan."
      >
        <div className="gap-3xs flex flex-col">
          <DateRangePicker value={range} onChange={setRange} />
          <span className="text-2xs text-muted-foreground">
            Seçim: {range?.from?.toISOString().split('T')[0] ?? '—'} →{' '}
            {range?.to?.toISOString().split('T')[0] ?? '—'}
          </span>
        </div>
      </Preview>
    </>
  );
}
