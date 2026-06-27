'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SWATCH_PALETTE } from '@/lib/margin-coloring';
import { cn } from '@/lib/utils';

interface ColorSwatchPickerProps {
  /** The currently selected color string (palette OKLCH or a custom hex). */
  value: string;
  /** Called with the new color string when the user picks a swatch or custom color. */
  onChange: (color: string) => void;
  /** Accessible label for the trigger + custom-input group. */
  label: string;
  /** Label for the custom-color row (e.g. "Özel renk"). */
  customLabel: string;
}

/** Treat anything that isn't one of the preset palette stops as a custom color. */
function isCustom(value: string): boolean {
  return !SWATCH_PALETTE.includes(value as (typeof SWATCH_PALETTE)[number]);
}

/**
 * Popover color picker: a quick-pick grid of the curated SWATCH_PALETTE plus a
 * custom-color row (a native color input + a hex field) so the user is never
 * boxed in by the presets. Composed from ui/Popover + ui/Input — no forks.
 * Chrome is token-driven; only the swatch fills are runtime-dynamic.
 *
 * @useWhen letting the user choose a margin-scale bucket color (palette or custom)
 */
export function ColorSwatchPicker({
  value,
  onChange,
  label,
  customLabel,
}: ColorSwatchPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  function selectSwatch(color: string): void {
    onChange(color);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'size-7 rounded-full border-2 transition-colors',
            'border-border hover:border-border-strong',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            'cursor-pointer',
          )}
          // runtime-dynamic: user-selected bucket color
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>

      <PopoverContent
        className="p-md w-auto"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="gap-sm flex flex-col">
          {/* Palette grid */}
          <div role="group" aria-label={label} className="gap-2xs grid grid-cols-6">
            {SWATCH_PALETTE.map((color) => {
              const isSelected = color === value;
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  aria-pressed={isSelected}
                  onClick={() => selectSwatch(color)}
                  className={cn(
                    'size-8 rounded-full border-2 transition-colors',
                    isSelected
                      ? 'border-foreground ring-ring ring-2 ring-offset-1'
                      : 'border-border hover:border-border-strong',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    'cursor-pointer',
                  )}
                  // runtime-dynamic: palette swatch color
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>

          {/* Custom color row */}
          <div className="border-border-muted gap-2xs pt-sm flex items-center border-t">
            <label className="border-border size-8 shrink-0 cursor-pointer overflow-hidden rounded-full border-2">
              <input
                type="color"
                aria-label={customLabel}
                value={isCustom(value) ? value : '#3aa657'}
                onChange={(e) => onChange(e.target.value)}
                className="size-12 -translate-x-1 -translate-y-1 cursor-pointer border-0 bg-transparent p-0"
              />
            </label>
            <Input
              size="sm"
              aria-label={customLabel}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
