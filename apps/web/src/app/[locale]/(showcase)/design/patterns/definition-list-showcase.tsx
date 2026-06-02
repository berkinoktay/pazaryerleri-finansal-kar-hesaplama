'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DefinitionList, type DefinitionListItem } from '@/components/patterns/definition-list';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { Badge } from '@/components/ui/badge';

const COMMISSION_BREAKDOWN: DefinitionListItem[] = [
  {
    term: 'Sipariş tutarı',
    description: <Currency value={new Decimal('249.90')} />,
  },
  {
    term: 'Kategori komisyonu',
    description: <Currency value={new Decimal('-59.07')} />,
    hint: '%23,64',
  },
  {
    term: 'Hizmet bedeli',
    description: <Currency value={new Decimal('-5.99')} />,
  },
  {
    term: 'Kargo bedeli',
    description: <Currency value={new Decimal('-29.99')} />,
    hint: 'standart desi',
  },
  {
    term: 'Net hakediş',
    description: <Currency value={new Decimal('154.85')} emphasis />,
  },
];

const ORDER_DETAIL: DefinitionListItem[] = [
  { term: 'Sipariş No', description: 'TY-2948021' },
  { term: 'Müşteri', description: 'Ayşe Demir' },
  {
    term: 'Pazaryeri',
    description: (
      <span className="gap-xs inline-flex items-center">
        <MarketplaceLogo platform="TRENDYOL" size="xs" alt="" />
        Trendyol Acme TR
      </span>
    ),
  },
  { term: 'Sipariş tarihi', description: '20 Nis 2026 · 14:32' },
  {
    term: 'Durum',
    description: <Badge tone="success">Teslim edildi</Badge>,
  },
];

const STORE_STATUS: DefinitionListItem[] = [
  {
    term: 'Mağaza durumu',
    description: 'Bağlantı aktif. Son senkron 8 dk önce; sonraki otomatik senkron 22 dk içinde.',
  },
  {
    term: 'Karlılık modu',
    description:
      "Komisyonlar pazaryeri API'sinden çekiliyor; manuel düzeltmeler ürün bazında uygulanır.",
  },
  {
    term: 'Sync politikası',
    description: 'Sipariş + ürün + hakediş günde 12 kez; webhook geldiğinde anlık güncelleme.',
  },
];

export function DefinitionListShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <Playground
        title="DefinitionList — layout · alignRight · dividers · dense"
        description="layout='inline' (term sol / desc sağ) varsayılan; 'stacked' (term üst / desc alt) uzun açıklamalar + sidebar için. alignRight=true → tabular-nums + sağ yaslama (parasal kolonlar). dividers satırlar arası 1px ayraç; dense sidebar/popover ritmi. ReactNode description'lar (Currency) ve item.hint korunur."
        controls={{
          layout: control.segment(['inline', 'stacked'], 'inline'),
          alignRight: control.bool(true, 'alignRight'),
          dividers: control.bool(true, 'dividers'),
          dense: control.bool(false, 'dense'),
        }}
        render={(v) => (
          <div className="border-border bg-card p-md max-w-sheet w-full rounded-md border">
            <DefinitionList
              items={COMMISSION_BREAKDOWN}
              layout={v.layout}
              alignRight={v.alignRight}
              dividers={v.dividers}
              dense={v.dense}
            />
          </div>
        )}
      />

      <Preview
        title="In-context — sipariş detayı (inline) · mağaza durumu (stacked)"
        description="Gerçek kullanım: inline term→value sipariş künyesi (ReactNode description'lar — logo, badge), stacked + dividers uzun açıklamalı mağaza durumu kartı. alignRight sadece parasal inline listelerde açılır."
      >
        <div className="gap-md grid lg:grid-cols-2">
          <div className="gap-3xs flex flex-col">
            <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
              Inline — sipariş detayı
            </span>
            <div className="border-border bg-card p-md rounded-md border">
              <DefinitionList items={ORDER_DETAIL} />
            </div>
          </div>
          <div className="gap-3xs flex flex-col">
            <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
              Stacked + dividers — mağaza durumu
            </span>
            <div className="border-border bg-card p-md max-w-sheet rounded-md border">
              <DefinitionList layout="stacked" dividers items={STORE_STATUS} />
            </div>
          </div>
        </div>
      </Preview>
    </div>
  );
}
