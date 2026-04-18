'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { DateRangePicker } from '@/components/patterns/date-range-picker';
import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Calendar } from '@/components/ui/calendar';

export default function DateTimePrimitivePage(): React.ReactElement {
  const [singleDate, setSingleDate] = React.useState<Date | undefined>(new Date('2026-04-15'));
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: new Date('2026-04-01'),
    to: new Date('2026-04-17'),
  });

  return (
    <>
      <PageHeader
        title="Tarih & saat"
        intent="react-day-picker üstüne oturmuş Calendar (tr-TR lokali) ve kompozit DateRangePicker."
      />
      <PrimitiveNav />

      <Preview
        title="Calendar — tek tarih"
        description="Türkçe ay ve haftanın günleri. tr-TR hafta başlangıcı Pazartesi."
      >
        <div className="border-border rounded-md border">
          <Calendar mode="single" selected={singleDate} onSelect={setSingleDate} />
        </div>
        <p className="mt-sm text-2xs text-muted-foreground">
          Seçilen: {singleDate ? singleDate.toLocaleDateString('tr-TR') : '—'}
        </p>
      </Preview>

      <Preview
        title="Calendar — aralık (2 ay)"
        description="Profitabilite ve rapor filtrelerinde 2-aylık range picker'ın canlı preview'ı."
      >
        <div className="border-border rounded-md border">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={range}
            onSelect={setRange}
            defaultMonth={range?.from}
          />
        </div>
      </Preview>

      <Preview
        title="DateRangePicker pattern"
        description="Calendar + Popover kompozisyonu. Dashboard sayfalarının filtre barında kullanılacak."
      >
        <div className="gap-sm grid">
          <DateRangePicker value={range} onChange={setRange} />
          <p className="text-2xs text-muted-foreground">
            Aralık seçildiğinde popover otomatik kapanır. Değeri parent state tutar.
          </p>
        </div>
      </Preview>
    </>
  );
}
