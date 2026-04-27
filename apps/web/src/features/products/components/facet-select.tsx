'use client';

import { ArrowDown01Icon, Cancel01Icon, Tick01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

interface FacetSelectProps {
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (next: string) => void;
  /** Label for the empty / "all" state — shown as the trigger when no value is selected. */
  emptyLabel: string;
  /** Placeholder for the search input inside the popover. */
  searchPlaceholder?: string;
  /** Hide the search box (e.g. small lists). */
  searchable?: boolean;
}

/**
 * Single-select facet dropdown — Popover + Command with a chip-style
 * trigger that shows the selected option's label. Clears via the X
 * button on the trigger when a value is set.
 */
export function FacetSelect({
  label,
  value,
  options,
  onChange,
  emptyLabel,
  searchPlaceholder,
  searchable = true,
}: FacetSelectProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  const hasValue = selected !== undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('gap-xs justify-between', hasValue && 'border-primary text-foreground')}
        >
          <span className="text-muted-foreground text-xs font-medium">{label}</span>
          <span className="text-foreground truncate text-sm">
            {hasValue ? selected.label : emptyLabel}
          </span>
          {hasValue ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`${label}: ${emptyLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('');
                }
              }}
              className="text-muted-foreground hover:text-foreground duration-fast cursor-pointer rounded-sm transition-colors"
            >
              <Cancel01Icon className="size-icon-xs" />
            </span>
          ) : (
            <ArrowDown01Icon className="size-icon-xs text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command>
          {searchable ? <CommandInput placeholder={searchPlaceholder ?? label} /> : null}
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => {
                    onChange(option.value === value ? '' : option.value);
                    setOpen(false);
                  }}
                >
                  <Tick01Icon
                    className={cn(
                      'size-icon-xs mr-xs',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.count !== undefined ? (
                    <span className="text-muted-foreground ml-xs text-2xs tabular-nums">
                      {option.count}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
