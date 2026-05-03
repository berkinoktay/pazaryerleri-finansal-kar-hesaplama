'use client';

import * as React from 'react';

import { TimeAgo } from '@/components/patterns/time-ago';

// Locked reference instant for deterministic showcase rendering. Real
// callers omit `now` and let TimeAgo resolve `new Date()` per render.
const NOW = new Date('2026-05-03T15:30:00Z');

const SAMPLES = [
  {
    label: 'Şimdi',
    value: new Date(NOW.getTime() - 15 * 1000),
  },
  {
    label: '2 dakika önce',
    value: new Date(NOW.getTime() - 2 * 60 * 1000),
  },
  {
    label: '8 dakika önce',
    value: new Date(NOW.getTime() - 8 * 60 * 1000),
  },
  {
    label: '1 saat önce',
    value: new Date(NOW.getTime() - 60 * 60 * 1000),
  },
  {
    label: '4 saat önce',
    value: new Date(NOW.getTime() - 4 * 60 * 60 * 1000),
  },
  {
    label: 'Dün',
    value: new Date(NOW.getTime() - 28 * 60 * 60 * 1000),
  },
  {
    label: '3 gün önce',
    value: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
  },
  {
    label: '2 hafta önce',
    value: new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000),
  },
];

export function TimeAgoShowcase(): React.ReactElement {
  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Aralıklar — sabit referans (2026-05-03 15:30 UTC)
        </span>
        <div className="border-border bg-card p-md gap-xs flex flex-col rounded-md border">
          {SAMPLES.map((sample) => (
            <div key={sample.label} className="gap-md flex items-baseline justify-between">
              <span className="text-2xs text-muted-foreground tabular-nums">{sample.label}</span>
              <TimeAgo value={sample.value} now={NOW} timezone="GMT+3" />
            </div>
          ))}
        </div>
        <span className="text-2xs text-muted-foreground">
          Hover et → tooltip&apos;te tam tarih + GMT+3.
        </span>
      </div>

      <div className="gap-3xs flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Boş değer — placeholder fallback
        </span>
        <div className="border-border bg-card p-md gap-xs flex flex-col rounded-md border">
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">value=null (default)</span>
            <TimeAgo value={null} />
          </div>
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">value=null (custom)</span>
            <TimeAgo value={null} placeholder="Hiç senkron yok" />
          </div>
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">value=undefined</span>
            <TimeAgo value={undefined} />
          </div>
        </div>
      </div>

      <div className="gap-3xs flex flex-col sm:col-span-2">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Default — caller now omitted, gerçek &quot;şimdi&quot;ye göre relative
        </span>
        <div className="border-border bg-card p-md gap-xs flex flex-col rounded-md border">
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">5 dk önce</span>
            <TimeAgo value={new Date(NOW.getTime() - 5 * 60 * 1000)} timezone="GMT+3" />
          </div>
          <div className="gap-md flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">2 saat önce</span>
            <TimeAgo value={new Date(NOW.getTime() - 2 * 60 * 60 * 1000)} timezone="GMT+3" />
          </div>
        </div>
        <span className="text-2xs text-muted-foreground">
          Gerçek kullanımda <code>now</code> prop&apos;u atlanır — TimeAgo her render&apos;da{' '}
          <code>new Date()</code> resolve eder. Showcase&apos;te NOW sabitiyle SSR-safe kalıyor.
        </span>
      </div>
    </div>
  );
}
