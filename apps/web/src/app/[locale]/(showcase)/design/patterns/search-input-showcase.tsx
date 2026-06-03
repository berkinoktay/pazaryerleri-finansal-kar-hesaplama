'use client';

import * as React from 'react';

import { SearchInput } from '@/components/patterns/search-input';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { Label } from '@/components/ui/label';

export function SearchInputShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="SearchInput — loading · invalid"
        description="Konvansiyon wrapper'ı: Search ikonu + lokalize placeholder + onClear üçlüsü tek API'de. Değer dolu olduğunda sağda X otomatik çıkar. loading=true → spinner (input yine yazılabilir); invalid=true → destructive kenarlık. type='search' yerine type='text' + inputMode='search' (çift clear butonu olmasın)."
        controls={{
          loading: control.bool(false),
          invalid: control.bool(false),
        }}
        render={(v) => (
          <SearchInput
            defaultValue="TY-2948000"
            loading={v.loading}
            invalid={v.invalid}
            onClear={() => undefined}
          />
        )}
      />

      <Preview
        title="SearchInput — controlled + onClear (etkileşimli)"
        description="Üç feature elle aynı üçlüyü kuruyordu — WET+1 promotion. Yaz: değer dolduğunda sağda X butonu belirir; tıkla → alan temizlenir, odak inputta kalır. Custom placeholder ile gerçek arama kolonu."
      >
        <SearchInputInteractiveDemo />
      </Preview>
    </div>
  );
}

function SearchInputInteractiveDemo(): React.ReactElement {
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
    </div>
  );
}
