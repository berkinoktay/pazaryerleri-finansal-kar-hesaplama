'use client';

import { Delete02Icon, DownloadCircle02Icon, Tag01Icon } from 'hugeicons-react';
import * as React from 'react';

import { BulkActionBar, type BulkAction } from '@/components/patterns/bulk-action-bar';
import { Button } from '@/components/ui/button';

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

export function BulkActionBarShowcase(): React.ReactElement {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = React.useState<string | null>(null);
  const [inlineSelected, setInlineSelected] = React.useState<Set<string>>(new Set(['1', '2']));

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

  const buildActions = (count: number): BulkAction[] => [
    {
      id: 'tag',
      label: 'Etiketle',
      icon: <Tag01Icon className="size-icon-sm" aria-hidden />,
      onClick: () => setLastAction(`Etiketle (${count})`),
    },
    {
      id: 'export',
      label: 'CSV indir',
      icon: <DownloadCircle02Icon className="size-icon-sm" aria-hidden />,
      onClick: () => setLastAction(`CSV indir (${count})`),
    },
    {
      id: 'delete',
      label: 'Sil',
      icon: <Delete02Icon className="size-icon-sm" aria-hidden />,
      tone: 'destructive',
      onClick: () => setLastAction(`Sil (${count})`),
    },
  ];

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
          actions={buildActions(selected.size)}
          countLabel={(count) => `${count} sipariş seçili`}
        />
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Inline — kart / split pane içinde
        </span>
        <div className="border-border bg-card p-md gap-sm flex flex-col rounded-md border">
          <div className="text-foreground text-sm">
            Burada inline BulkActionBar hep render edilir; toolbar yerine kullanılan varyant.
          </div>
          <BulkActionBar
            position="inline"
            selectedCount={inlineSelected.size}
            onClear={() => setInlineSelected(new Set())}
            actions={buildActions(inlineSelected.size)}
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
    </div>
  );
}
