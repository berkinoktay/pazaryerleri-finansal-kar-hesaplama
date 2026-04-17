'use client';

import { ArrowDown01Icon, PlusSignIcon } from 'hugeicons-react';
import * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface Store {
  id: string;
  name: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
  status: 'active' | 'paused' | 'error';
}

const PLATFORM_LABEL: Record<Store['platform'], string> = {
  TRENDYOL: 'Trendyol',
  HEPSIBURADA: 'Hepsiburada',
};

const STATUS_TONE: Record<Store['status'], string> = {
  active: 'bg-success',
  paused: 'bg-muted-foreground',
  error: 'bg-destructive',
};

export interface StoreSwitcherProps {
  stores: Store[];
  activeStoreId: string;
  onSelect: (storeId: string) => void;
  onAddStore?: () => void;
}

/**
 * Top slot of the context rail. Displays the active store as a compact
 * chip and opens a command palette with fuzzy-search across all stores.
 * Platform and sync-status dot are baked in so switching is never an
 * act of faith.
 */
export function StoreSwitcher({
  stores,
  activeStoreId,
  onSelect,
  onAddStore,
}: StoreSwitcherProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const active = stores.find((s) => s.id === activeStoreId) ?? stores[0];

  if (!active) return <div className="h-9 w-full" />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'gap-xs border-border bg-background px-xs py-xs duration-fast flex w-full items-center rounded-md border text-left text-sm shadow-xs transition-colors',
            'hover:border-border-strong',
            'focus-visible:outline-none',
          )}
        >
          <span className={cn('size-2 shrink-0 rounded-full', STATUS_TONE[active.status])} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-foreground truncate font-medium">{active.name}</span>
            <span className="text-2xs text-muted-foreground">
              {PLATFORM_LABEL[active.platform]}
            </span>
          </span>
          <ArrowDown01Icon className="size-icon-sm text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Mağaza ara…" />
          <CommandList>
            <CommandEmpty>Mağaza bulunamadı.</CommandEmpty>
            <CommandGroup heading="Mağazalar">
              {stores.map((store) => (
                <CommandItem
                  key={store.id}
                  value={`${store.name} ${PLATFORM_LABEL[store.platform]}`}
                  onSelect={() => {
                    onSelect(store.id);
                    setOpen(false);
                  }}
                >
                  <span className={cn('size-2 rounded-full', STATUS_TONE[store.status])} />
                  <div className="flex flex-1 flex-col leading-tight">
                    <span className="font-medium">{store.name}</span>
                    <span className="text-2xs text-muted-foreground">
                      {PLATFORM_LABEL[store.platform]}
                    </span>
                  </div>
                  {store.id === activeStoreId ? (
                    <span className="text-2xs text-muted-foreground">Aktif</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {onAddStore ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={onAddStore}>
                    <PlusSignIcon className="size-icon-sm text-muted-foreground" />
                    Mağaza bağla
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
