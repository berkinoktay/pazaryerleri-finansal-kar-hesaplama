'use client';

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Database01Icon,
  Loading03Icon,
  RefreshIcon,
  ShoppingBag01Icon,
} from 'hugeicons-react';
import * as React from 'react';

import { ActivityFeed, type ActivityFeedEntry } from '@/components/patterns/activity-feed';
import { EmptyState } from '@/components/patterns/empty-state';

const SYNC_HISTORY: ActivityFeedEntry[] = [
  {
    id: 'sync-running',
    tone: 'info',
    icon: <Loading03Icon className="animate-spin" />,
    title: 'Ürün senkronizasyonu çalışıyor',
    description: '142 / 250 ürün işlendi.',
    source: 'Trendyol Ana Mağaza',
    timestamp: 'şimdi',
  },
  {
    id: 'orders-completed',
    tone: 'success',
    icon: <CheckmarkCircle02Icon />,
    title: 'Sipariş senkronizasyonu tamamlandı',
    description: '34 yeni sipariş eklendi, 12 sipariş güncellendi.',
    source: 'Trendyol Ana Mağaza',
    timestamp: '8 dk önce',
  },
  {
    id: 'rate-limit',
    tone: 'warning',
    icon: <Alert02Icon />,
    title: 'API rate-limit yaklaşıldı',
    description: 'Pazaryeri 60 sn için yavaşlatıldı; otomatik geri çekilme aktif.',
    source: 'Hepsiburada Acme',
    timestamp: '1 saat önce',
    detail: (
      <>
        Endpoint: <code>/orders</code> · 80 / 100 req/dk · backoff 60s
      </>
    ),
  },
  {
    id: 'auth-failed',
    tone: 'destructive',
    icon: <Alert02Icon />,
    title: 'API kimlik doğrulaması başarısız',
    description:
      'Mağaza API anahtarı geçersiz görünüyor. Yeniden bağlanmak için Ayarlar > Mağazalar.',
    source: 'Trendyol İstanbul',
    timestamp: '4 saat önce',
  },
  {
    id: 'manual-trigger',
    tone: 'neutral',
    icon: <RefreshIcon />,
    title: 'Manuel senkron başlatıldı',
    description: 'Berkin Oktay tarafından panelden tetiklendi.',
    timestamp: 'Dün 18:42',
  },
];

const COMPACT_AUDIT: ActivityFeedEntry[] = [
  {
    id: 'cost-update',
    tone: 'info',
    title: 'Ürün maliyeti güncellendi',
    description: '12 ürünün maliyet bilgisi yeniden hesaplandı.',
    timestamp: '3 dk önce',
  },
  {
    id: 'expense-added',
    tone: 'success',
    title: 'Reklam gideri eklendi',
    description: '₺3.250,00 — Trendyol kampanya bütçesi.',
    timestamp: '12 dk önce',
  },
  {
    id: 'commission-edit',
    tone: 'warning',
    title: 'Komisyon oranı düzenlendi',
    description: 'Elektronik kategorisi: %23,64 → %25,00.',
    timestamp: '1 saat önce',
  },
];

export function ActivityFeedShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Senkron geçmişi — full (icon + tone + detail)
        </span>
        <div className="border-border bg-card p-md rounded-md border">
          <ActivityFeed entries={SYNC_HISTORY} aria-label="Senkronizasyon geçmişi" />
        </div>
      </div>

      <div className="gap-md grid lg:grid-cols-2">
        <div className="gap-sm flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            Kompakt — sidebar / context-rail için
          </span>
          <div className="border-border bg-card p-md rounded-md border">
            <ActivityFeed entries={COMPACT_AUDIT} compact aria-label="Son aktivite (kompakt)" />
          </div>
        </div>

        <div className="gap-sm flex flex-col">
          <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            Boş durum — yedek node verilirse render edilir
          </span>
          <div className="border-border bg-card p-md rounded-md border">
            <ActivityFeed
              entries={[]}
              aria-label="Aktivite yok"
              emptyState={
                <EmptyState
                  icon={Database01Icon}
                  title="Henüz aktivite yok"
                  description="İlk senkron tamamlandığında burada görünecek."
                />
              }
            />
          </div>
        </div>
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Connector kapalı — düz liste varyantı
        </span>
        <div className="border-border bg-card p-md rounded-md border">
          <ActivityFeed
            showConnector={false}
            entries={[
              {
                id: 'a',
                tone: 'success',
                icon: <ShoppingBag01Icon />,
                title: 'Yeni sipariş alındı',
                description: 'TY-2948021 · ₺249,90',
                timestamp: '2 dk önce',
              },
              {
                id: 'b',
                tone: 'success',
                icon: <ShoppingBag01Icon />,
                title: 'Yeni sipariş alındı',
                description: 'TY-2948020 · ₺139,50',
                timestamp: '4 dk önce',
              },
              {
                id: 'c',
                tone: 'success',
                icon: <ShoppingBag01Icon />,
                title: 'Yeni sipariş alındı',
                description: 'TY-2948019 · ₺89,00',
                timestamp: '6 dk önce',
              },
            ]}
            aria-label="Son siparişler"
          />
        </div>
      </div>
    </div>
  );
}
