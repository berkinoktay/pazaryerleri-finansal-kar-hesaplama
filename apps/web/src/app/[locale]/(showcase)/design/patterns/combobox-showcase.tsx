'use client';

import { Tag01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Combobox, type ComboboxOption } from '@/components/patterns/combobox';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Label } from '@/components/ui/label';

/**
 * Real Trendyol top-level categories — sample picked from the
 * production category tree. Showcase consumers see actual product
 * categories instead of "Option A / Option B" wireframe content.
 */
const TRENDYOL_CATEGORIES: ComboboxOption[] = [
  {
    value: 'electronics',
    label: 'Elektronik',
    description: 'Telefon, bilgisayar, ses sistemleri',
    icon: <Tag01Icon />,
  },
  {
    value: 'fashion',
    label: 'Giyim & Moda',
    description: 'Kadın, erkek, çocuk giyim',
    icon: <Tag01Icon />,
  },
  {
    value: 'home',
    label: 'Ev & Yaşam',
    description: 'Mobilya, mutfak, banyo',
    icon: <Tag01Icon />,
  },
  {
    value: 'cosmetics',
    label: 'Kozmetik & Kişisel Bakım',
    description: 'Cilt, makyaj, parfüm',
    icon: <Tag01Icon />,
  },
  {
    value: 'sports',
    label: 'Spor & Outdoor',
    description: 'Fitness, kamp, bisiklet',
    icon: <Tag01Icon />,
  },
  {
    value: 'books',
    label: 'Kitap & Hobi',
    description: 'Kitap, oyuncak, müzik',
    icon: <Tag01Icon />,
  },
  {
    value: 'baby',
    label: 'Anne & Bebek',
    description: 'Bebek bakım, çocuk giyim',
    icon: <Tag01Icon />,
    disabled: true,
  },
];

const STORE_OPTIONS: ComboboxOption[] = [
  {
    value: 'store-trendyol-acme',
    label: 'Trendyol Acme TR',
    description: 'Ana mağaza · 1.472 sipariş',
    icon: <MarketplaceLogo platform="TRENDYOL" size="xs" alt="" />,
  },
  {
    value: 'store-hepsiburada-acme',
    label: 'Hepsiburada Acme',
    description: 'İkinci mağaza · 480 sipariş',
    icon: <MarketplaceLogo platform="HEPSIBURADA" size="xs" alt="" />,
  },
  {
    value: 'store-trendyol-istanbul',
    label: 'Trendyol İstanbul',
    description: 'Şube · sync hatası',
    icon: <MarketplaceLogo platform="TRENDYOL" size="xs" alt="" />,
  },
];

export function ComboboxShowcase(): React.ReactElement {
  const [category, setCategory] = React.useState<string | null>('electronics');
  const [store, setStore] = React.useState<string | null>(null);
  const [emptyChoice, setEmptyChoice] = React.useState<string | null>(null);

  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <Label>Trendyol kategorisi</Label>
        <Combobox value={category} onChange={setCategory} options={TRENDYOL_CATEGORIES} />
        <span className="text-2xs text-muted-foreground">
          Açılır panelde “ara” — yazdıkça filtre çalışır. Disabled satır (Anne & Bebek) seçilemez.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>Mağaza seç (boş başlangıç)</Label>
        <Combobox
          value={store}
          onChange={setStore}
          options={STORE_OPTIONS}
          placeholder="Mağaza seç…"
          searchPlaceholder="Mağaza adı veya pazaryeri…"
        />
        <span className="text-2xs text-muted-foreground">
          Marketplace logosu satır ikonu olarak; description ile ek bağlam.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>Yükleniyor (loading)</Label>
        <Combobox value={null} onChange={() => undefined} options={[]} loading />
        <span className="text-2xs text-muted-foreground">
          Async option fetch sırasında — chevron yerine spinner; trigger açılır ama liste boş.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <Label>Hatalı alan (invalid)</Label>
        <Combobox
          value={emptyChoice}
          onChange={setEmptyChoice}
          options={TRENDYOL_CATEGORIES.slice(0, 3)}
          invalid
        />
        <span className="text-2xs text-destructive">Bir kategori seçmen gerekiyor.</span>
      </div>
    </div>
  );
}
