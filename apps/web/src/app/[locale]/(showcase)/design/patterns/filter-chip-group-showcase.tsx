'use client';

import * as React from 'react';

import { FilterChipGroup, type FilterChip } from '@/components/patterns/filter-chip-group';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { StatusDot } from '@/components/ui/status-dot';

type FilterId = 'status' | 'marketplace' | 'category' | 'date' | 'minRevenue';

const SEED_FILTERS: Record<
  FilterId,
  { group: string; label: React.ReactNode; icon?: React.ReactNode }
> = {
  status: {
    group: 'Durum',
    label: 'Aktif',
    icon: <StatusDot tone="success" size="sm" />,
  },
  marketplace: {
    group: 'Pazaryeri',
    label: 'Trendyol',
    icon: <MarketplaceLogo platform="TRENDYOL" size="xs" alt="" />,
  },
  category: {
    group: 'Kategori',
    label: 'Elektronik',
  },
  date: {
    group: 'Tarih',
    label: '1 Nis – 30 Nis 2026',
  },
  minRevenue: {
    group: 'Min ciro',
    label: '₺10.000',
  },
};

export function FilterChipGroupShowcase(): React.ReactElement {
  const [active, setActive] = React.useState<Set<FilterId>>(
    new Set(['status', 'marketplace', 'date'] as FilterId[]),
  );

  const remove = (id: FilterId): void => {
    setActive((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const clearAll = (): void => setActive(new Set());

  const restoreAll = (): void => setActive(new Set(Object.keys(SEED_FILTERS) as FilterId[]));

  const chips: FilterChip[] = Array.from(active).map((id) => ({
    id,
    group: SEED_FILTERS[id].group,
    label: SEED_FILTERS[id].label,
    icon: SEED_FILTERS[id].icon,
    onRemove: () => remove(id),
  }));

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Group + value (Durum: Aktif) — interactive
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <FilterChipGroup chips={chips} onClearAll={clearAll} />
          <div className="gap-xs flex">
            <button
              type="button"
              onClick={restoreAll}
              className="text-2xs text-primary hover:text-primary/80 underline-offset-4 hover:underline"
            >
              Tüm filtreleri geri yükle (demo)
            </button>
            {active.size === 0 ? (
              <span className="text-2xs text-muted-foreground">
                · Boş chips: bileşen render etmiyor.
              </span>
            ) : null}
          </div>
        </div>
        <span className="text-2xs text-muted-foreground">
          chips=[] olduğunda FilterChipGroup null döner — caller&apos;ın visibility gating yapmasına
          gerek yok.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Sadece label (group atlanır) — basit chip listesi
        </span>
        <div className="border-border bg-card p-md rounded-md border">
          <FilterChipGroup
            chips={[
              { id: 'a', label: 'Elektronik', onRemove: () => undefined },
              { id: 'b', label: 'Giyim & Moda', onRemove: () => undefined },
              { id: 'c', label: 'Ev & Yaşam', onRemove: () => undefined },
              { id: 'd', label: 'Kozmetik', onRemove: () => undefined },
            ]}
            onClearAll={() => undefined}
          />
        </div>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Read-only (onRemove yok) + clear-all yok
        </span>
        <div className="border-border bg-card p-md rounded-md border">
          <FilterChipGroup
            chips={[
              {
                id: 'period',
                group: 'Dönem',
                label: 'Nisan 2026',
              },
              {
                id: 'org',
                group: 'Org',
                label: 'Acme A.Ş.',
              },
              {
                id: 'currency',
                group: 'Para birimi',
                label: 'TRY',
              },
            ]}
          />
        </div>
        <span className="text-2xs text-muted-foreground">
          Read-only kullanım — &quot;şu an aktif olan kapsam&quot; bilgisi, kullanıcı değiştiremez.
        </span>
      </div>
    </div>
  );
}
