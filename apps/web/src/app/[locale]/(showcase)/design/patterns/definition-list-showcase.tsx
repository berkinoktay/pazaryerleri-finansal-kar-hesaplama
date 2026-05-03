'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DefinitionList, type DefinitionListItem } from '@/components/patterns/definition-list';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Badge } from '@/components/ui/badge';

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

const STORE_CREDENTIALS: DefinitionListItem[] = [
  { term: 'Mağaza adı', description: 'Trendyol Acme TR' },
  { term: 'Pazaryeri', description: 'Trendyol' },
  { term: 'Seller ID', description: '143928' },
  {
    term: 'API anahtarı',
    description: <code className="text-2xs">tk_live_••••••••••2J9k</code>,
    hint: 'AES-256-GCM şifreli',
  },
  {
    term: 'Ortam',
    description: <Badge tone="info">Production</Badge>,
  },
  { term: 'Bağlandı', description: '14 Şub 2026' },
];

export function DefinitionListShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-md grid lg:grid-cols-2">
        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            Inline (default) — sipariş detayı
          </span>
          <div className="border-border bg-card p-md rounded-md border">
            <DefinitionList items={ORDER_DETAIL} />
          </div>
        </div>

        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            Inline + alignRight + dividers — komisyon dağılımı
          </span>
          <div className="border-border bg-card p-md rounded-md border">
            <DefinitionList items={COMMISSION_BREAKDOWN} alignRight dividers />
          </div>
          <span className="text-2xs text-muted-foreground">
            alignRight=true → tabular-nums + sağ yaslama, parasal kolonlar için.
          </span>
        </div>
      </div>

      <div className="gap-md grid lg:grid-cols-2">
        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            Stacked — uzun açıklamalar / sidebar
          </span>
          <div className="border-border bg-card p-md max-w-sheet rounded-md border">
            <DefinitionList
              layout="stacked"
              dividers
              items={[
                {
                  term: 'Mağaza durumu',
                  description:
                    'Bağlantı aktif. Son senkron 8 dk önce; sonraki otomatik senkron 22 dk içinde.',
                },
                {
                  term: 'Karlılık modu',
                  description:
                    "Komisyonlar pazaryeri API'sinden çekiliyor; manuel düzeltmeler ürün bazında uygulanır.",
                },
                {
                  term: 'Sync politikası',
                  description:
                    'Sipariş + ürün + hakediş günde 12 kez; webhook geldiğinde anlık güncelleme.',
                },
              ]}
            />
          </div>
        </div>

        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            Dense — popover / context-rail kompakt
          </span>
          <div className="border-border bg-card p-md max-w-sheet rounded-md border">
            <DefinitionList items={STORE_CREDENTIALS} dense />
          </div>
        </div>
      </div>
    </div>
  );
}
