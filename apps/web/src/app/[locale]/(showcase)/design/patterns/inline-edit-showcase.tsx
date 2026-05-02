'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { InlineEdit } from '@/components/patterns/inline-edit';
import { formatTrMoney, MoneyInput, parseTrMoney } from '@/components/patterns/money-input';
import { Label } from '@/components/ui/label';

export function InlineEditShowcase(): React.ReactElement {
  const [storeName, setStoreName] = React.useState('Trendyol Ana Mağaza');
  const [productCost, setProductCost] = React.useState<Decimal>(new Decimal('249.9'));
  const [emptyValue, setEmptyValue] = React.useState('');

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <Label>Mağaza adı (text)</Label>
        <InlineEdit value={storeName} onCommit={setStoreName} ariaLabel="Mağaza adını düzenle" />
        <span className="text-2xs text-muted-foreground">
          Üzerine gel → düzenle ikonu görünür. Tıkla → input. Enter ile commit, Esc ile iptal.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>Ürün maliyeti (Currency display + MoneyInput editor)</Label>
        <InlineEdit
          value={formatTrMoney(productCost, 2)}
          onCommit={(next) => {
            const parsed = parseTrMoney(next);
            if (parsed !== null) setProductCost(parsed);
          }}
          ariaLabel="Ürün maliyetini düzenle"
          renderDisplay={(displayValue) => {
            const parsed = parseTrMoney(displayValue) ?? new Decimal(0);
            return <Currency value={parsed} emphasis />;
          }}
          renderEdit={({ value, onChange, ref, onKeyDown, onBlur }) => (
            <MoneyInput
              ref={ref}
              value={parseTrMoney(value)}
              onChange={(next) => onChange(next ? formatTrMoney(next, 2) : '')}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              autoFocus
            />
          )}
        />
        <span className="text-2xs text-muted-foreground">
          renderDisplay → Currency, renderEdit → MoneyInput. Tipo-güvenli edit-in-place.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>Boş değer (placeholder)</Label>
        <InlineEdit
          value={emptyValue}
          onCommit={setEmptyValue}
          placeholder="— ekle —"
          ariaLabel="Açıklama ekle"
        />
        <span className="text-2xs text-muted-foreground">
          Değer boşsa placeholder muted renkte gösterilir; tıklayınca düzenlenebilir.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>Pasif (disabled)</Label>
        <InlineEdit value="Trendyol API anahtarı" onCommit={() => undefined} disabled />
        <span className="text-2xs text-muted-foreground">
          Sistem-yönetilen değerler — tıklanamaz, hover ikonu yok.
        </span>
      </div>
    </div>
  );
}
