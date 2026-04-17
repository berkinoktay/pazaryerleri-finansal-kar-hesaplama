'use client';

import { PlusSignIcon, Search01Icon } from 'hugeicons-react';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { RADIUS_KEYS, SIZE_KEYS } from '@/lib/variants';

export default function ButtonsPrimitivePage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Buton & Rozet"
        intent="Button ve Badge paylaşılan size/radius prop setini kullanır — aynı anahtar (`md`, `lg`) tüm component'lerde aynı token'a çözülür."
      />
      <PrimitiveNav />

      <Preview
        title="Button varyantları"
        description="Default, Secondary, Outline, Ghost, Link, Destructive. Varyant hiyerarşiyi taşır — sayfada sadece bir primary olmalı."
      >
        <div className="gap-xs flex flex-wrap">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </Preview>

      <Preview
        title="Button size (paylaşılan prop)"
        description="sm / md (default) / lg. Aynı 'size' prop'u her input-sınıfı bileşende aynı yüksekliği verir."
      >
        <div className="gap-md flex flex-col">
          {SIZE_KEYS.map((size) => (
            <div key={size} className="gap-xs flex flex-wrap items-center">
              <span className="text-2xs text-muted-foreground w-12 font-mono">{size}</span>
              <Button size={size}>{size.toUpperCase()}</Button>
              <Button size={size} variant="outline">
                Outline
              </Button>
              <Button size={size} variant="ghost">
                Ghost
              </Button>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Button radius (paylaşılan prop)"
        description="none, xs, sm, md (default), lg, xl, 2xl, full. Aynı anahtar Badge, Input, Card'da da çalışır."
      >
        <div className="gap-xs flex flex-wrap items-center">
          {RADIUS_KEYS.map((r) => (
            <Button key={r} variant="outline" radius={r}>
              {r}
            </Button>
          ))}
        </div>
      </Preview>

      <Preview
        title="Icon button'lar"
        description="icon (40px) ve icon-sm (32px) tek-aksiyon dairesel butonlar için."
      >
        <div className="gap-xs flex flex-wrap items-center">
          <Button size="icon" aria-label="Ekle">
            <PlusSignIcon className="size-icon-sm" />
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="Ara">
            <Search01Icon className="size-icon-sm" />
          </Button>
          <Button size="icon" radius="full" variant="outline" aria-label="Ara (dairesel)">
            <Search01Icon className="size-icon-sm" />
          </Button>
        </div>
      </Preview>

      <Preview title="Button durumları" description="Disabled, loading (custom), active focus.">
        <div className="gap-xs flex flex-wrap">
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <Button variant="destructive" disabled>
            Disabled
          </Button>
        </div>
      </Preview>

      <Preview
        title="Badge tonları"
        description="Neutral, Primary, Outline, Success, Destructive, Warning, Info. Ton rengi yüzeyle taşınır; yan-şerit border yasak."
      >
        <div className="gap-xs flex flex-wrap">
          <Badge>Neutral</Badge>
          <Badge tone="primary">Primary</Badge>
          <Badge tone="outline">Outline</Badge>
          <Badge tone="success">Teslim edildi</Badge>
          <Badge tone="destructive">İade</Badge>
          <Badge tone="warning">Bekleyen</Badge>
          <Badge tone="info">Kargoda</Badge>
        </div>
      </Preview>

      <Preview
        title="Badge size & radius"
        description="sm / md (default) / lg × full pill veya md köşe. Paylaşılan prop mekanizması."
      >
        <div className="gap-md flex flex-col">
          <div className="gap-xs flex flex-wrap items-center">
            {SIZE_KEYS.map((size) => (
              <Badge key={size} size={size} tone="success">
                {size}
              </Badge>
            ))}
          </div>
          <div className="gap-xs flex flex-wrap items-center">
            {(['full', 'md', 'sm'] as const).map((r) => (
              <Badge key={r} radius={r} tone="info">
                radius = {r}
              </Badge>
            ))}
          </div>
        </div>
      </Preview>

      <Preview
        title="Toggle"
        description="Tek açık/kapalı kontrol. Button varyantı gibi davranır ama on/off state ayırt eder."
      >
        <div className="gap-xs flex flex-wrap">
          <Toggle defaultPressed>Kalın</Toggle>
          <Toggle>İtalik</Toggle>
          <Toggle variant="outline">Altı çizili</Toggle>
        </div>
      </Preview>

      <Preview
        title="ToggleGroup"
        description="Segmented control (single/multiple). Döneme göre filtre, hizalama seçici, platform filtresi gibi yerlerde."
      >
        <div className="gap-md flex flex-col">
          <ToggleGroup type="single" defaultValue="month" variant="outline">
            <ToggleGroupItem value="day">Gün</ToggleGroupItem>
            <ToggleGroupItem value="week">Hafta</ToggleGroupItem>
            <ToggleGroupItem value="month">Ay</ToggleGroupItem>
            <ToggleGroupItem value="quarter">Çeyrek</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="multiple" defaultValue={['trendyol']}>
            <ToggleGroupItem value="trendyol">Trendyol</ToggleGroupItem>
            <ToggleGroupItem value="hepsiburada">Hepsiburada</ToggleGroupItem>
            <ToggleGroupItem value="n11">n11</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </Preview>
    </>
  );
}
