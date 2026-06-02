'use client';

import {
  Delete02Icon,
  DownloadCircle02Icon,
  Mail01Icon,
  PrinterIcon,
  Tag01Icon,
} from 'hugeicons-react';
import * as React from 'react';

import { BulkActionBar, type BulkAction } from '@/components/patterns/bulk-action-bar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface MockOrder {
  id: string;
  number: string;
  customer: string;
  total: string;
}

const MOCK_ORDERS: MockOrder[] = [
  { id: '1', number: 'TY-2948021', customer: 'Ayşe Demir', total: '₺249,90' },
  { id: '2', number: 'TY-2948020', customer: 'Mehmet Kaya', total: '₺139,50' },
  { id: '3', number: 'TY-2948019', customer: 'Zeynep Arslan', total: '₺89,00' },
  { id: '4', number: 'TY-2948018', customer: 'Ahmet Yılmaz', total: '₺512,00' },
  { id: '5', number: 'TY-2948017', customer: 'Emine Şahin', total: '₺78,40' },
];

// Single action catalog for every demo on this page — pick the ids a demo
// needs. The floating + inline bars use a compact 3-action set (with a
// destructive delete); the overflow demo uses all five. One source kills the
// near-identical buildActions / buildManyActions pair.
type ActionId = 'tag' | 'export' | 'mail' | 'print' | 'delete';

const ACTION_CATALOG: Record<
  ActionId,
  { label: string; icon: React.ReactNode; tone?: 'destructive' }
> = {
  tag: { label: 'Etiketle', icon: <Tag01Icon className="size-icon-sm" aria-hidden /> },
  export: {
    label: 'CSV indir',
    icon: <DownloadCircle02Icon className="size-icon-sm" aria-hidden />,
  },
  mail: { label: 'E-posta gönder', icon: <Mail01Icon className="size-icon-sm" aria-hidden /> },
  print: { label: 'Yazdır', icon: <PrinterIcon className="size-icon-sm" aria-hidden /> },
  delete: {
    label: 'Sil',
    icon: <Delete02Icon className="size-icon-sm" aria-hidden />,
    tone: 'destructive',
  },
};

const COMPACT_ACTIONS: ActionId[] = ['tag', 'export', 'delete'];
const FULL_ACTIONS: ActionId[] = ['tag', 'export', 'mail', 'print', 'delete'];

function buildActions(
  ids: ActionId[],
  count: number,
  onAction: (label: string) => void,
): BulkAction[] {
  return ids.map((id) => {
    const def = ACTION_CATALOG[id];
    return {
      id,
      label: def.label,
      icon: def.icon,
      tone: def.tone,
      onClick: () => onAction(`${def.label} (${count})`),
    };
  });
}

export function BulkActionBarShowcase(): React.ReactElement {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = React.useState<string | null>(null);
  const [inlineSelected, setInlineSelected] = React.useState<Set<string>>(new Set(['1', '2']));
  const [busy, setBusy] = React.useState(false);
  const [overflowSelected, setOverflowSelected] = React.useState<Set<string>>(new Set(['1', '2']));

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected((prev) =>
      prev.size === MOCK_ORDERS.length ? new Set() : new Set(MOCK_ORDERS.map((o) => o.id)),
    );
  };

  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Floating — viewport tabanına yapışır, seçim 0&apos;dan büyükken görünür
        </span>
        <div className="border-border bg-card overflow-hidden rounded-md border">
          <table className="w-full">
            <thead className="bg-muted/40 border-border border-b">
              <tr>
                <th className="px-sm py-xs w-10">
                  <input
                    type="checkbox"
                    aria-label="Tümünü seç"
                    checked={selected.size === MOCK_ORDERS.length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-left font-medium">
                  Sipariş
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-left font-medium">
                  Müşteri
                </th>
                <th className="px-sm py-xs text-2xs text-muted-foreground text-right font-medium tabular-nums">
                  Toplam
                </th>
              </tr>
            </thead>
            <tbody>
              {MOCK_ORDERS.map((order) => {
                const isSelected = selected.has(order.id);
                return (
                  <tr
                    key={order.id}
                    className={`border-border border-b last:border-0 ${
                      isSelected ? 'bg-muted/30' : ''
                    }`}
                  >
                    <td className="px-sm py-xs">
                      <input
                        type="checkbox"
                        aria-label={`${order.number} satırını seç`}
                        checked={isSelected}
                        onChange={() => toggle(order.id)}
                      />
                    </td>
                    <td className="px-sm py-xs text-foreground text-sm font-medium">
                      {order.number}
                    </td>
                    <td className="px-sm py-xs text-muted-foreground text-sm">{order.customer}</td>
                    <td className="px-sm py-xs text-foreground text-right text-sm tabular-nums">
                      {order.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <span className="text-2xs text-muted-foreground">
          Bir veya daha fazla satır seç → ekranın altında BulkActionBar belirir.
        </span>
        {lastAction !== null ? (
          <span className="text-2xs text-info">Son aksiyon: {lastAction}</span>
        ) : null}

        <BulkActionBar
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          actions={buildActions(COMPACT_ACTIONS, selected.size, setLastAction)}
          countLabel={(count) => `${count} sipariş seçili`}
        />
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Inline — kart / split pane içinde · busy (in-flight) durumu
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <div className="text-foreground text-sm">
            Inline BulkActionBar hep render edilir. <strong>busy</strong> açıkken bir toplu işlem
            sürüyormuş gibi spinner görünür ve tüm aksiyonlar + temizle düğmesi devre dışı kalır.
          </div>
          <label className="gap-xs text-foreground flex items-center text-sm">
            <Switch checked={busy} onCheckedChange={setBusy} />
            İşlem sürüyor (busy)
          </label>
          <BulkActionBar
            position="inline"
            selectedCount={inlineSelected.size}
            onClear={() => setInlineSelected(new Set())}
            actions={buildActions(COMPACT_ACTIONS, inlineSelected.size, setLastAction)}
            busy={busy}
            countLabel={(count) => `${count} ürün seçili`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInlineSelected(new Set(['1', '2', '3']))}
          >
            3 satır seç (demo)
          </Button>
        </div>
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          overflowAfter — fazla aksiyon &quot;Daha fazla&quot; menüsüne taşınır
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <div className="text-foreground text-sm">
            5 aksiyon, <code className="text-xs">overflowAfter=2</code> → ilk 2 satır içinde,
            kalanlar bir dropdown&apos;a toplanır. Dar ekranlarda aksiyon etiketleri ikon-only olur.
          </div>
          <BulkActionBar
            position="inline"
            selectedCount={overflowSelected.size}
            onClear={() => setOverflowSelected(new Set())}
            actions={buildActions(FULL_ACTIONS, overflowSelected.size, setLastAction)}
            overflowAfter={2}
            countLabel={(count) => `${count} kayıt seçili`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOverflowSelected(new Set(['1', '2']))}
          >
            Seç (demo)
          </Button>
        </div>
      </div>
    </div>
  );
}
