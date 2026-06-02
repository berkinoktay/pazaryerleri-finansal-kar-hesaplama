'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { PercentageInput } from '@/components/patterns/percentage-input';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { Label } from '@/components/ui/label';

export function PercentageInputShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="PercentageInput — scale · nonNegative · invalid"
        description="MoneyInput'un kardeşi: % leading slot (Türkçe konvansiyonu '%23,64', '23,64%' değil), aynı tr-TR parser, Decimal çıktı. Sınır YOK varsayılan — komisyon %100'ü geçebilir, marj negatif olabilir. nonNegative aç → negatif girişi pozitife çevirir. scale=0 tam yüzde (KDV, stopaj)."
        controls={{
          scale: control.segment(['0', '2'], '2'),
          nonNegative: control.bool(false),
          invalid: control.bool(false),
        }}
        render={(v) => (
          <PercentageInput
            scale={Number(v.scale)}
            nonNegative={v.nonNegative}
            invalid={v.invalid}
            defaultValue={new Decimal('23.64')}
            placeholder="0,00"
          />
        )}
      />

      <Preview
        title="PercentageInput — komisyon, marj, indirim (etkileşimli)"
        description="Komisyon, vergi, marj, indirim için. Zarar pozisyonunda negatif marj normaldir; nonNegative yalnız indirim gibi pozitif-zorunlu alanlarda. Yaz, çıktıyı canlı izle."
      >
        <PercentageInputContractDemo />
      </Preview>
    </div>
  );
}

function PercentageInputContractDemo(): React.ReactElement {
  const [commission, setCommission] = React.useState<Decimal | null>(new Decimal('23.64'));
  const [margin, setMargin] = React.useState<Decimal | null>(new Decimal('-5.2'));
  const [discount, setDiscount] = React.useState<Decimal | null>(null);

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="commission">Komisyon oranı</Label>
        <PercentageInput
          id="commission"
          value={commission}
          onChange={setCommission}
          placeholder="0,00"
        />
        <span className="text-2xs text-muted-foreground">
          Trendyol elektronik kategorisi · varsayılan %23,64
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="margin">Kar marjı (negatif olabilir)</Label>
        <PercentageInput id="margin" value={margin} onChange={setMargin} placeholder="0,00" />
        <span className="text-2xs text-muted-foreground">
          Değer: {margin === null ? 'null' : `%${margin.toString()}`}
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="discount">İndirim oranı (nonNegative)</Label>
        <PercentageInput
          id="discount"
          value={discount}
          onChange={setDiscount}
          nonNegative
          placeholder="0"
        />
        <span className="text-2xs text-muted-foreground">
          Negatif girersen otomatik pozitife çevrilir.
        </span>
      </div>
    </div>
  );
}
