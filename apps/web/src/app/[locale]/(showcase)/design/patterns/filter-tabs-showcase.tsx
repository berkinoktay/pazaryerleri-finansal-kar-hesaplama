'use client';

import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

type OrderStatus = 'all' | 'open' | 'shipped' | 'completed' | 'returned';
type ProductStatus = 'all' | 'onSale' | 'archived' | 'blocked' | 'inactive';

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
  const [orderStatus, setOrderStatus] = React.useState<OrderStatus>('open');
  const [productStatus, setProductStatus] = React.useState<ProductStatus>('all');
  const [pillStatus, setPillStatus] = React.useState<'pending' | 'approved' | 'rejected'>(
    'pending',
  );
  const [loading, setLoading] = React.useState(false);

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Sipariş listesi — kanonik underline + count
        </span>
        <FilterTabs<OrderStatus>
          value={orderStatus}
          onValueChange={setOrderStatus}
          options={ORDER_OPTIONS}
        />
        <span className="text-2xs text-muted-foreground">
          Aktif: <span className="text-foreground font-medium">{orderStatus}</span> — gerçekte
          DataTable bu state&apos;i okuyup satırları filtreler.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Ürün listesi — count eksik bir tab ile (`Pasif` sayım dışı)
        </span>
        <FilterTabs<ProductStatus>
          value={productStatus}
          onValueChange={setProductStatus}
          options={PRODUCT_OPTIONS}
        />
        <span className="text-2xs text-muted-foreground">
          `count` undefined ise rozet hiç render edilmez — sadece label gösterilir.
        </span>
      </div>

      <div className="gap-xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          loading=true — skeleton sayım
        </span>
        <button
          type="button"
          className="border-border bg-background px-sm py-3xs text-2xs hover:bg-muted self-start rounded-md border font-medium transition-colors"
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1600);
          }}
        >
          {loading ? 'Yükleniyor…' : '1.6 saniyelik yüklemeyi tetikle'}
        </button>
        <FilterTabs<OrderStatus>
          value={orderStatus}
          onValueChange={setOrderStatus}
          options={ORDER_OPTIONS}
          loading={loading}
        />
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Variant: pill — constrained kart içinde
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <span className="text-foreground text-sm font-medium">Hakediş onay durumu</span>
          <FilterTabs<'pending' | 'approved' | 'rejected'>
            value={pillStatus}
            onValueChange={setPillStatus}
            options={PILL_OPTIONS}
            variant="pill"
          />
          <span className="text-2xs text-muted-foreground">
            Reddedilmiş 0 — açıkça sıfır gösterilir, atlanmaz. &quot;Veri yok&quot; yerine
            &quot;veri var, gerçekten sıfır&quot; sinyali.
          </span>
        </div>
      </div>
    </div>
  );
}
