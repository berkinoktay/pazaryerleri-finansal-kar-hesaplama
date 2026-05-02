'use client';

import { ArrowDown01Icon, Tick02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
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
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Searchable single-select picker. shadcn/ui ships only a recipe (a
 * docs page composing Popover + Command + Button). This PazarSync
 * pattern wraps the recipe into a single API so consumers don't
 * re-wire the same Popover state, cmdk filtering, and selection
 * commit logic for every category / brand / store picker.
 *
 * For 2–7 fully-visible mutually exclusive options use `RadioGroup`
 * (no popover overhead, all options on screen). For a fixed list
 * with no typeahead use the shadcn `Select` primitive. For multi-
 * select use a future `MultiCombobox` (not built yet — flag a need
 * if a real use case appears).
 *
 * The cmdk `value` prop in CommandItem is what cmdk filters against,
 * so we pass `${option.value} ${option.label}` to support matching
 * either the stored id or the visible label.
 *
 * @useWhen rendering a searchable single-select picker over a finite list of options (use Select for short fixed lists, RadioGroup for 2-7 visible options, future MultiCombobox for multi-select)
 */

export interface ComboboxOption {
  /** Stored value committed via onChange. Must be unique. */
  value: string;
  /** Visible label. Searched against the cmdk filter. */
  label: string;
  /** Optional secondary line under the label (sub-text, code, slug). */
  description?: string;
  /** Optional leading visual — icon, marketplace logo, color swatch. */
  icon?: React.ReactNode;
  /** Disable selection of this option. */
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Controlled value. `null` represents nothing selected. */
  value?: string | null;
  /** Fires once on selection (auto-closes the popover). Pass `null` to clear externally. */
  onChange?: (next: string | null) => void;
  /** Options shown in the dropdown. */
  options: ComboboxOption[];
  /** Trigger label when no value is selected. Defaults to localized "Seçim yap…". */
  placeholder?: string;
  /** cmdk search input placeholder. Defaults to localized "Ara…". */
  searchPlaceholder?: string;
  /** Empty-state message when the search yields zero results. Defaults to localized "Sonuç bulunamadı". */
  emptyMessage?: string;
  /** Disables the trigger entirely. */
  disabled?: boolean;
  /** Shows a spinner in place of the trigger chevron. Does not disable the trigger. */
  loading?: boolean;
  /** Forwards `aria-invalid` to the trigger so destructive border tokens kick in via the Button variant. */
  invalid?: boolean;
  /** Trigger button size — matches Button / Input / SelectTrigger size ladder. */
  triggerSize?: 'sm' | 'md' | 'lg';
  /** Forwarded to PopoverContent. Defaults to start so the popover left-aligns with the trigger. */
  align?: 'start' | 'center' | 'end';
  /** Override the dropdown panel width. Defaults to matching the trigger via `--radix-popover-trigger-width`. */
  contentClassName?: string;
  /** className forwarded to the trigger Button. */
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  loading = false,
  invalid = false,
  triggerSize = 'md',
  align = 'start',
  contentClassName,
  className,
}: ComboboxProps): React.ReactElement {
  const t = useTranslations('common.combobox');
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={triggerSize}
          disabled={disabled}
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn(
            'gap-xs w-full justify-between font-normal',
            invalid && 'border-destructive focus-visible:border-destructive',
            className,
          )}
        >
          <span className="gap-xs flex min-w-0 flex-1 items-center truncate text-left">
            {selected !== null ? (
              <>
                {selected.icon !== undefined ? (
                  <span className="text-muted-foreground [&_svg]:size-icon-sm flex shrink-0 items-center">
                    {selected.icon}
                  </span>
                ) : null}
                <span className="text-foreground truncate">{selected.label}</span>
              </>
            ) : (
              <span className="text-muted-foreground truncate">
                {placeholder ?? t('placeholder')}
              </span>
            )}
          </span>
          {loading ? (
            <Spinner className="text-muted-foreground" />
          ) : (
            <ArrowDown01Icon
              aria-hidden
              className="size-icon-sm text-muted-foreground shrink-0 opacity-70"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
      >
        <Command
          // Default cmdk filter is case-insensitive substring match against
          // the per-item `value` prop; we set value=`${id} ${label}` below
          // so search hits either the id or the visible label.
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder ?? t('searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{emptyMessage ?? t('empty')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected?.value === option.value;
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.value} ${option.label}`}
                    disabled={option.disabled}
                    onSelect={() => {
                      onChange?.(isSelected ? null : option.value);
                      setOpen(false);
                    }}
                    className={cn('gap-xs items-start', isSelected && 'bg-muted')}
                  >
                    {option.icon !== undefined ? (
                      <span className="text-muted-foreground [&_svg]:size-icon-sm mt-3xs flex shrink-0 items-center">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="gap-3xs flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="text-foreground truncate text-sm">{option.label}</span>
                      {option.description !== undefined ? (
                        <span className="text-muted-foreground text-2xs truncate">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <Tick02Icon
                        aria-hidden
                        className="size-icon-sm text-primary mt-3xs shrink-0"
                      />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
