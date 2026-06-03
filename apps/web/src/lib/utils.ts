import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The design system renames Tailwind's spacing scale to semantic role tokens
 * (`--spacing-3xs … --spacing-5xl`, plus the icon / thumbnail / layout / width
 * roles wired in `app/globals.css`). tailwind-merge's DEFAULT config only knows
 * the numeric scale, so it can't tell that e.g. `px-sm` and `p-0`, `gap-3xs` and
 * `gap-0`, or `size-icon-xs` and `size-8` belong to the same conflict group — it
 * keeps BOTH and lets the CSS cascade decide, which silently drops `className`
 * overrides (a base component's `px-sm` quietly wins over a consumer's `p-0`).
 *
 * Registering the custom spacing names here teaches twMerge the scale so spacing
 * utilities (p / m / gap / space / w / h / size / inset / min-* / max-* …)
 * dedupe correctly. KEEP THIS LIST IN SYNC with the `--spacing-*` block in
 * `app/globals.css`. (Radius already uses Tailwind's default key names, and the
 * color group's permissive validator already dedupes custom colors, so neither
 * needs registering.)
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        // core 4pt scale
        '3xs',
        '2xs',
        'xs',
        'sm',
        'md',
        'lg',
        'xl',
        '2xl',
        '3xl',
        '4xl',
        '5xl',
        // icon sizes (size-*)
        'icon-xs',
        'icon-sm',
        'icon',
        'icon-lg',
        'icon-xl',
        // thumbnail footprints
        'thumb-sm',
        'thumb-md',
        'thumb-lg',
        'thumb-xl',
        // layout rails / heights
        'rail-icon',
        'rail-context',
        'settings-aside',
        'header-h',
        'page-header-h',
        'tile-min',
        'tile-min-sm',
        'table-row-h',
        'content-max',
        'prose-max',
        'shell-demo',
        // role-based width tokens (max-w-*)
        'input-narrow',
        'input',
        'form',
        'sheet',
        'sheet-wide',
        'modal',
        'dropdown-popover',
        'pagesize-select',
        'headline',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
