'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { MoneyInput } from '@/components/patterns/money-input';
import { Label } from '@/components/ui/label';

export function MoneyInputShowcase(): React.ReactElement {
  const [productCost, setProductCost] = React.useState<Decimal | null>(new Decimal('1234.5'));
  const [shippingCost, setShippingCost] = React.useState<Decimal | null>(null);
  const [adSpend, setAdSpend] = React.useState<Decimal | null>(new Decimal('249.9'));

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="cost">Ürün maliyeti</Label>
        <MoneyInput id="cost" value={productCost} onChange={setProductCost} placeholder="0,00" />
        <span className="text-2xs text-muted-foreground">
          Decimal.js: <Currency value={productCost ?? 0} dimWhenZero />
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="shipping">Kargo bedeli (boş = atlanmış)</Label>
        <MoneyInput
          id="shipping"
          value={shippingCost}
          onChange={setShippingCost}
          placeholder="Boş bırakırsan atlanır"
        />
        <span className="text-2xs text-muted-foreground">
          Değer: {shippingCost === null ? 'null' : shippingCost.toString()}
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="ads">Reklam gideri (nonNegative)</Label>
        <MoneyInput id="ads" value={adSpend} onChange={setAdSpend} nonNegative placeholder="0,00" />
        <span className="text-2xs text-muted-foreground">
          Negatif girersen otomatik pozitife çevrilir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="ads-invalid">Hatalı alan örneği</Label>
        <MoneyInput
          id="ads-invalid"
          defaultValue={new Decimal('99.99')}
          invalid
          placeholder="0,00"
        />
        <span className="text-2xs text-destructive">
          Bu maliyet için bir kategori seçmen gerekiyor.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="usd">USD (özel sembol)</Label>
        <MoneyInput id="usd" symbol="$" defaultValue={new Decimal('299')} placeholder="0.00" />
        <span className="text-2xs text-muted-foreground">
          Sembol prop&apos;u TRY dışı pazarlar / ileride için.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="whole">Tam TRY (scale=0)</Label>
        <MoneyInput id="whole" scale={0} defaultValue={new Decimal('150000')} placeholder="0" />
        <span className="text-2xs text-muted-foreground">
          Ondalıksız tutarlar için (örn. komisyon eşiği).
        </span>
      </div>
    </div>
  );
}
