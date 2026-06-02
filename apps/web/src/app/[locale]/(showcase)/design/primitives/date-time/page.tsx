'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Calendar } from '@/components/ui/calendar';
import { Link } from '@/i18n/navigation';

// Fixed ISO date strings — never a runtime clock (SSR-safe; deterministic markup).
const SINGLE_SEED = '2026-04-15';
const RANGE_FROM_SEED = '2026-04-01';
const RANGE_TO_SEED = '2026-04-17';

export default function DateTimePrimitivePage(): React.ReactElement {
  const [singleDate, setSingleDate] = React.useState<Date | undefined>(new Date(SINGLE_SEED));
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: new Date(RANGE_FROM_SEED),
    to: new Date(RANGE_TO_SEED),
  });

  return (
    <>
      <PageHeader
        title="Tarih & saat"
        intent="react-day-picker üstüne oturmuş Calendar (tr-TR lokali, Pazartesi hafta başı). Calendar seçim state'ini kendi yönetir — prop matrisi olmadığı için Playground değil, canlı seçilebilir Preview ile gösterilir."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Calendar"
        description="Türkçe ay + haftanın günleri; bugün küçük primary dot ile işaretli, seçili gün solid primary dolgu, aralık ortası soft-primary pill. mode='single' tek tarih, mode='range' aralık seçer — her ikisi de canlı tıklanabilir."
      >
        <Preview
          title="Calendar — tek tarih (mode='single')"
          description="Tek gün seçimi. tr-TR hafta başlangıcı Pazartesi. Seçili tarih parent state'te tutulur."
        >
          <div className="border-border w-fit rounded-md border">
            <Calendar mode="single" selected={singleDate} onSelect={setSingleDate} />
          </div>
          <p className="mt-sm text-2xs text-muted-foreground">
            Seçilen: {singleDate ? singleDate.toLocaleDateString('tr-TR') : '—'}
          </p>
        </Preview>

        <Preview
          title="Calendar — aralık, 2 ay (mode='range')"
          description="Profitabilite ve rapor filtrelerinde kullanılan 2-aylık aralık seçici. Endpoint'ler solid primary, aralık ortası soft-primary continuous pill."
        >
          <div className="border-border w-fit rounded-md border">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={range}
              onSelect={setRange}
              defaultMonth={range?.from}
            />
          </div>
        </Preview>

        <p className="text-2xs text-muted-foreground">
          {
            "Popover'a sarılı kompozit DateRangePicker bir pattern'dir, primitive değil — filtre barı kullanımı için "
          }
          <Link href="/design/patterns/forms" className="text-foreground underline">
            /design/patterns/forms
          </Link>{' '}
          sayfasına bakın.
        </p>
      </ShowcaseSection>
    </>
  );
}
