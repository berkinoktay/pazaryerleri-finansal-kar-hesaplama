'use client';

import { ArrowDown01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('storeSwitcher');
  const [open, setOpen] = React.useState(false);
  const active = stores.find((s) => s.id === activeStoreId) ?? stores[0];

  if (!active) {
    if (!onAddStore) return <div className="h-9 w-full" />;
    return (
      <button
        type="button"
        onClick={onAddStore}
        className={cn(
          'gap-sm border-border-strong bg-background px-sm py-xs duration-fast flex w-full items-center rounded-md border border-dashed text-left text-sm transition-colors',
          'hover:border-primary hover:bg-accent',
          'focus-visible:outline-none',
        )}
      >
        <span
          className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
          aria-hidden="true"
        >
          <PlusSignIcon className="size-icon-sm" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-foreground font-semibold">{t('connectFirst.title')}</span>
          <span className="text-2xs text-muted-foreground">{t('connectFirst.hint')}</span>
        </span>
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'gap-sm border-border bg-background px-sm py-xs duration-fast flex w-full items-center rounded-md border text-left text-sm shadow-xs transition-colors',
            'hover:border-border-strong',
            'focus-visible:outline-none',
          )}
        >
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md font-bold uppercase',
              active.platform === 'TRENDYOL'
                ? 'bg-warning-surface text-warning'
                : 'bg-info-surface text-info',
            )}
            aria-hidden="true"
          >
            {active.platform === 'TRENDYOL' ? 'T' : 'H'}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-foreground truncate font-semibold">{active.name}</span>
            <span className="text-2xs gap-3xs flex items-center">
              <span className={cn('size-1.5 rounded-full', STATUS_TONE[active.status])} />
              <span className="text-muted-foreground">{PLATFORM_LABEL[active.platform]}</span>
            </span>
          </span>
          <ArrowDown01Icon className="size-icon-sm text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t('searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup heading={t('heading')}>
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
                    <span className="text-2xs text-muted-foreground">{t('active')}</span>
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
                    {t('addStore')}
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
