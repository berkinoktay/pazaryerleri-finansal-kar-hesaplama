'use client';

import * as React from 'react';

import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';
import { SIZE_KEYS } from '@/lib/variants';

type OrderStatus = 'all' | 'open' | 'shipped' | 'completed' | 'returned';
type ProductStatus = 'all' | 'onSale' | 'archived' | 'blocked' | 'inactive';

// FilterTabs.variant comes from the Tabs primitive: pill (segmented control
// inside a card / toolbar) or underline (page-section strip). `size` is the
// shared SIZE_KEYS scale.
const FILTER_TABS_VARIANTS = ['pill', 'underline'] as const;

const ORDER_OPTIONS: FilterTabOption<OrderStatus>[] = [
  { value: 'all', label: 'Tümü', count: 1472 },
  { value: 'open', label: 'Açık', count: 38 },
  { value: 'shipped', label: 'Kargoda', count: 92 },
  { value: 'completed', label: 'Tamamlandı', count: 1304 },
  { value: 'returned', label: 'İade', count: 38 },
];

const PRODUCT_OPTIONS: FilterTabOption<ProductStatus>[] = [
  { value: 'all', label: 'Tümü', count: 2148 },
  { value: 'onSale', label: 'Satışta', count: 2080 },
  { value: 'archived', label: 'Arşiv', count: 56 },
  { value: 'blocked', label: 'Engellenmiş', count: 12 },
  // No count — demonstrates the undefined-count fallback (label-only tab)
  { value: 'inactive', label: 'Pasif' },
];

const PILL_OPTIONS: FilterTabOption<'pending' | 'approved' | 'rejected'>[] = [
  { value: 'pending', label: 'Beklemede', count: 4 },
  { value: 'approved', label: 'Onaylanmış', count: 28 },
  { value: 'rejected', label: 'Reddedilmiş', count: 0 }, // explicit 0 — trust signal
];

export function FilterTabsShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="FilterTabs — variant · size · loading"
        description="Tek state'li canlı şerit. Seçili sekme bileşenin kendi state'i (tıkla); kontroller sadece variant / size / loading config prop'larını çevirir. loading=true → her sayım slot'u eşit-footprint Skeleton."
        controls={{
          variant: control.segment(FILTER_TABS_VARIANTS, 'underline'),
          size: control.segment(SIZE_KEYS, 'md'),
          loading: control.bool(false),
        }}
        render={(v) => <FilterTabsDemo variant={v.variant} size={v.size} loading={v.loading} />}
      />

      <Preview
        title="Count eksik bir tab (`Pasif` sayım dışı)"
        description="`count` undefined ise rozet hiç render edilmez — sadece label gösterilir. Bir şeritte sayımlı ve sayımsız sekmeler karışabilir."
      >
        <ProductTabsDemo />
      </Preview>

      <Preview
        title="Variant: pill — constrained kart içinde, explicit 0"
        description='pill variant kart / toolbar yüzeyi için. Reddedilmiş 0 — açıkça sıfır gösterilir, atlanmaz. "Veri yok" yerine "veri var, gerçekten sıfır" sinyali.'
      >
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <span className="text-foreground text-sm font-medium">Hakediş onay durumu</span>
          <PillTabsDemo />
        </div>
      </Preview>
    </div>
  );
}

function FilterTabsDemo({
  variant,
  size,
  loading,
}: {
  variant: (typeof FILTER_TABS_VARIANTS)[number];
  size: (typeof SIZE_KEYS)[number];
  loading: boolean;
}): React.ReactElement {
  const [status, setStatus] = React.useState<OrderStatus>('open');
  return (
    <div className="gap-3xs flex flex-1 flex-col">
      <FilterTabs<OrderStatus>
        value={status}
        onValueChange={setStatus}
        options={ORDER_OPTIONS}
        variant={variant}
        size={size}
        loading={loading}
      />
      <span className="text-2xs text-muted-foreground">
        Aktif: <span className="text-foreground font-medium">{status}</span> — gerçekte DataTable bu
        state&apos;i okuyup satırları filtreler.
      </span>
    </div>
  );
}

function ProductTabsDemo(): React.ReactElement {
  const [status, setStatus] = React.useState<ProductStatus>('all');
  return (
    <FilterTabs<ProductStatus> value={status} onValueChange={setStatus} options={PRODUCT_OPTIONS} />
  );
}

function PillTabsDemo(): React.ReactElement {
  const [status, setStatus] = React.useState<'pending' | 'approved' | 'rejected'>('pending');
  return (
    <FilterTabs<'pending' | 'approved' | 'rejected'>
      value={status}
      onValueChange={setStatus}
      options={PILL_OPTIONS}
      variant="pill"
    />
  );
}
