'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { PercentageInput } from '@/components/patterns/percentage-input';
import { Label } from '@/components/ui/label';

export function PercentageInputShowcase(): React.ReactElement {
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
          Zarar pozisyonunda negatif marj normaldir.
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

      <div className="gap-3xs flex flex-col">
        <Label htmlFor="vat">KDV (scale=0)</Label>
        <PercentageInput id="vat" scale={0} defaultValue={new Decimal('20')} placeholder="0" />
        <span className="text-2xs text-muted-foreground">
          Tam yüzde değerleri (KDV, stopaj) için ondalıksız.
        </span>
      </div>
    </div>
  );
}
