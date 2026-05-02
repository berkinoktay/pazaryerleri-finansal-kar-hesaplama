'use client';

import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { Label } from '@/components/ui/label';

export function SearchInputShowcase(): React.ReactElement {
  const [orderQuery, setOrderQuery] = React.useState('TY-2948000');
  const [productQuery, setProductQuery] = React.useState('');

  return (
    <div className="gap-md max-w-form grid">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="order-search">Sipariş ara (controlled + onClear)</Label>
        <SearchInput
          id="order-search"
          value={orderQuery}
          onChange={(event) => setOrderQuery(event.target.value)}
          onClear={() => setOrderQuery('')}
        />
        <span className="text-2xs text-muted-foreground">
          Değer dolduğunda sağda X butonu otomatik çıkar.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="product-search">Ürün ara (custom placeholder)</Label>
        <SearchInput
          id="product-search"
          value={productQuery}
          onChange={(event) => setProductQuery(event.target.value)}
          onClear={() => setProductQuery('')}
          placeholder="Ürün adı, SKU, barkod…"
        />
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="loading-search">Async sonuç (loading)</Label>
        <SearchInput
          id="loading-search"
          defaultValue="trendyol"
          loading
          onClear={() => undefined}
        />
        <span className="text-2xs text-muted-foreground">
          loading=true → sağda spinner; input yine yazılabilir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="invalid-search">Hatalı arama ifadesi</Label>
        <SearchInput id="invalid-search" defaultValue="!!" invalid onClear={() => undefined} />
        <span className="text-2xs text-destructive">En az 2 alfanumerik karakter girmelisin.</span>
      </div>
    </div>
  );
}
