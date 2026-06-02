'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { MoneyInput } from '@/components/patterns/money-input';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { Label } from '@/components/ui/label';

export function MoneyInputShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="MoneyInput — scale · nonNegative · invalid · symbol"
        description="Tek etkileşimli yüzey: kontrolleri çevir, ₺ leading slot + tr-TR ayrıştırmasını canlı gör. Değeri sen yazarsın; aşağıdaki şerit yalnız config prop'larını döndürür. scale=0 tam TRY, sembol prop'u TRY dışı pazarlar için."
        controls={{
          scale: control.segment(['0', '2'], '2'),
          nonNegative: control.bool(false),
          invalid: control.bool(false),
          symbol: control.text('₺', 'symbol', '₺ / $ / €'),
        }}
        render={(v) => (
          <MoneyInput
            scale={Number(v.scale)}
            nonNegative={v.nonNegative}
            invalid={v.invalid}
            symbol={v.symbol === '' ? '₺' : v.symbol}
            defaultValue={new Decimal('1234.5')}
            placeholder="0,00"
          />
        )}
      />

      <Preview
        title="MoneyInput — null/empty kontratı (etkileşimli)"
        description="Boş alan null'a çözülür ('user 0 yazdı' ≠ 'user temizledi'). Değer Decimal'a çevrilir ve Currency display ile aynı kontratı paylaşır — buraya girdiğin tutar <Currency /> ile aynen okunur. Alanları doldur/temizle, çıktıyı canlı izle."
      >
        <MoneyInputContractDemo />
      </Preview>
    </div>
  );
}

function MoneyInputContractDemo(): React.ReactElement {
  const [productCost, setProductCost] = React.useState<Decimal | null>(new Decimal('1234.5'));
  const [shippingCost, setShippingCost] = React.useState<Decimal | null>(null);

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="cost">Ürün maliyeti</Label>
        <MoneyInput id="cost" value={productCost} onChange={setProductCost} placeholder="0,00" />
        <span className="text-2xs text-muted-foreground">
          Currency display: <Currency value={productCost ?? 0} dimWhenZero />
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
    </div>
  );
}
