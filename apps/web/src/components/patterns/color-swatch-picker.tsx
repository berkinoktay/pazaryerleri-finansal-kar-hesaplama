'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { SWATCH_PALETTE } from '@/lib/margin-coloring';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColorSwatchPickerProps {
  /** The currently selected OKLCH color string. */
  value: string;
  /** Called with the new color string when the user selects a swatch. */
  onChange: (color: string) => void;
  /**
   * Accessible label for the trigger button. Defaults to 'Renk sec'.
   * Pass a translated string from the parent once i18n is wired (Faz 3).
   */
  label?: string;
}

// ---------------------------------------------------------------------------
// ColorSwatchPicker
// ---------------------------------------------------------------------------

/**
 * A Popover-based color picker composed from the curated SWATCH_PALETTE.
 * The trigger is a round swatch button showing the current color. The popover
 * content is a grid of palette swatches; clicking one calls `onChange` and
 * closes the popover.
 *
 * Token-only for all chrome; runtime-dynamic color fills are annotated with
 * `// runtime-dynamic:` comments.
 *
 * @useWhen letting the user select a margin-scale bucket color from the curated palette
 */
export function ColorSwatchPicker({
  value,
  onChange,
  label,
}: ColorSwatchPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  const ariaLabel = label ?? 'Renk sec';

  function handleSelect(color: string): void {
    onChange(color);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Trigger: a round swatch button with the current color as background. */}
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            // Size + shape
            'size-7 rounded-full border-2',
            // Border transitions to signal interactive state
            'border-border hover:border-border-strong focus-visible:border-border-strong',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            // Cursor
            'cursor-pointer',
          )}
          style={{
            // runtime-dynamic: user-selected swatch color
            backgroundColor: value,
          }}
        />
      </PopoverTrigger>

      <PopoverContent
        className="p-sm w-auto"
        align="start"
        // Prevent the popover itself from receiving focus-stealing on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Palette grid — 7 columns to fit ~14 swatches in two rows */}
        <div role="group" aria-label="Renk paleti" className="gap-xs grid grid-cols-7">
          {SWATCH_PALETTE.map((color) => {
            const isSelected = color === value;
            return (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={isSelected}
                onClick={() => handleSelect(color)}
                className={cn(
                  // Size + shape
                  'size-7 rounded-full border-2',
                  // Border: selected = ring, else standard border
                  isSelected
                    ? 'border-foreground ring-ring ring-2 ring-offset-1'
                    : 'border-border hover:border-border-strong',
                  // Focus
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                  'cursor-pointer',
                )}
                style={{
                  // runtime-dynamic: palette swatch color
                  backgroundColor: color,
                }}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
