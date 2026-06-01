'use client';

import { Cancel01Icon, PlusSignIcon, Tick02Icon } from 'hugeicons-react';
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
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RangeInput } from '@/components/ui/range-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  convertRowValue,
  defaultOperatorFor,
  emptyValueFor,
  isFilterOperator,
  isFilterRowComplete,
  rangeBounds,
  type FilterFieldDef,
  type FilterRow,
} from '@/lib/advanced-filter';
import { cn } from '@/lib/utils';

/**
 * Generic Advanced Filtering surface (Option A). Given a per-table catalog of
 * FilterFieldDef[], it renders a `+ Filtre ekle` menu and one interactive pill
 * per applied filter. The interaction follows the approved mockup:
 *
 *  - The add menu is a TWO-CARD popover: a field list on the left, and — the
 *    moment a field is picked — the value editor opens as a SEPARATE card right
 *    beside it (its own height, a small gap between them, the list stays open).
 *    Flags are one-tap (no editor).
 *  - Apply / Cancel live INSIDE the editor footer. Each `Uygula` commits that
 *    one row; there is no separate global apply button. `İptal` discards the
 *    in-progress edit.
 *  - Each commit (add / edit / remove) calls `onApply` with the full, updated
 *    FilterRow[] — the caller owns the committed value (URL via nuqs). Only
 *    complete rows are ever committed (Uygula is disabled until then), so a
 *    chip in the bar always carries a real value.
 *
 * The bar's controls (chip · add button · the editor's select / inputs /
 * buttons) all share the `sm` (h-8) control height so the row reads as one tidy
 * strip.
 *
 * Feature-agnostic: products today, orders once its page settles.
 *
 * @useWhen building a multi-dimension, operator-aware filter bar above a table
 */

// Flush search bar (no box) that keeps only a bottom border — a clean separator
// between the search row and the list below it. Passed to CommandInput's
// `wrapperClassName`, which the primitive merges over its default boxed shell.
const SEARCH_WRAPPER = 'm-0 rounded-none border-0 border-b bg-transparent shadow-none';

// The value-editor card surface, shared by BOTH the add flow (beside the field
// list) and the chip-edit popover so the two render identically. Each is wrapped
// in a chromeless (transparent, no-padding) popover and the card supplies its
// own surface — the add flow needs it because it shows two cards side by side,
// and the edit flow reuses the same wrapper so it matches pixel-for-pixel.
const EDITOR_CARD = 'bg-popover border-border w-80 overflow-hidden rounded-lg border shadow-md';

export interface AdvancedFilterMenuProps {
  /** The table's filterable dimensions (localized labels + facet options). */
  fields: FilterFieldDef[];
  /** Committed filters (from the URL). These are the chips shown. */
  value: FilterRow[];
  /** Commit the full, updated filter set. Called on every add / edit / remove. */
  onApply: (rows: FilterRow[]) => void;
}

export function AdvancedFilterMenu({
  fields,
  value,
  onApply,
}: AdvancedFilterMenuProps): React.ReactElement {
  const fieldByKey = React.useMemo(
    () => new Map(fields.map((field) => [field.key, field])),
    [fields],
  );
  const usedKeys = new Set(value.map((row) => row.field));

  // Add (append) or replace a row by id, then commit the whole set.
  function commitRow(row: FilterRow): void {
    const exists = value.some((existing) => existing.id === row.id);
    onApply(
      exists ? value.map((existing) => (existing.id === row.id ? row : existing)) : [...value, row],
    );
  }

  function removeRow(id: string): void {
    onApply(value.filter((row) => row.id !== id));
  }

  return (
    <div className="gap-xs flex flex-wrap items-center">
      {value.map((row) => {
        const def = fieldByKey.get(row.field);
        if (def === undefined) return null;
        return (
          <FilterChip
            key={row.id}
            field={def}
            row={row}
            onCommit={commitRow}
            onRemove={() => removeRow(row.id)}
          />
        );
      })}

      <AddFilterButton fields={fields} usedKeys={usedKeys} onCommit={commitRow} />
    </div>
  );
}

// ─── Add-filter: field list + adjacent value-editor card (two cards) ─────────

interface AddFilterButtonProps {
  fields: FilterFieldDef[];
  usedKeys: Set<string>;
  onCommit: (row: FilterRow) => void;
}

function AddFilterButton({ fields, usedKeys, onCommit }: AddFilterButtonProps): React.ReactElement {
  const t = useTranslations('common.advancedFilter');
  const [open, setOpen] = React.useState(false);
  // The row currently being composed in the editor card. null ⇒ only the field
  // list is shown (no editor card yet).
  const [pending, setPending] = React.useState<FilterRow | null>(null);

  const available = fields.filter((field) => !usedKeys.has(field.key));
  const groups = groupByLabel(available);
  const pendingField =
    pending !== null ? fields.find((field) => field.key === pending.field) : undefined;

  function pick(field: FilterFieldDef): void {
    // Flags carry no value — one tap commits the chip and closes the menu.
    if (field.dataType === 'flag') {
      onCommit(freshRow(field));
      close();
      return;
    }
    setPending(freshRow(field));
  }

  function commit(): void {
    if (pending !== null) onCommit(pending);
    close();
  }

  function close(): void {
    setOpen(false);
    setPending(null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPending(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2xs">
          <PlusSignIcon className="size-icon-xs" aria-hidden />
          {t('addFilter')}
        </Button>
      </PopoverTrigger>
      {/* Transparent shell so the two inner cards are the visible surfaces —
          each its own height (items-start), a small gap between them (not glued). */}
      <PopoverContent className="w-auto border-0 bg-transparent p-0 shadow-none" align="start">
        <div className="gap-2xs flex items-start">
          {/* Field list card. */}
          <div className="bg-popover border-border w-72 overflow-hidden rounded-lg border shadow-md">
            <Command>
              <CommandInput placeholder={t('searchFields')} wrapperClassName={SEARCH_WRAPPER} />
              <CommandList className="max-h-80">
                <CommandEmpty>{t('noFields')}</CommandEmpty>
                {groups.map(([groupLabel, groupFields]) => (
                  <CommandGroup key={groupLabel} heading={groupLabel}>
                    {groupFields.map((field) => (
                      <CommandItem
                        key={field.key}
                        value={`${field.groupLabel} ${field.label}`}
                        onSelect={() => pick(field)}
                        aria-selected={pending?.field === field.key}
                        className="py-xs cursor-pointer"
                      >
                        {field.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </div>

          {/* Value-editor card — beside the list, at its own height. */}
          {pending !== null && pendingField !== undefined ? (
            <div className={EDITOR_CARD}>
              <FilterEditor
                field={pendingField}
                row={pending}
                onChange={(patch) =>
                  setPending((row) => (row !== null ? { ...row, ...patch } : row))
                }
                onCommit={commit}
                onCancel={() => setPending(null)}
              />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Interactive applied chip (Badge shell + clickable body + remove) ────────

interface FilterChipProps {
  field: FilterFieldDef;
  row: FilterRow;
  onCommit: (row: FilterRow) => void;
  onRemove: () => void;
}

function FilterChip({ field, row, onCommit, onRemove }: FilterChipProps): React.ReactElement {
  const t = useTranslations('common.advancedFilter');
  const isFlag = field.dataType === 'flag';

  // Local draft so İptal / closing the popover discards an in-progress edit;
  // re-seeded from the committed row each time the editor opens.
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FilterRow>(row);

  const removeButton = (
    <button
      type="button"
      onClick={onRemove}
      aria-label={t('removeFilter')}
      className={cn(
        'flex h-full w-6 shrink-0 cursor-pointer items-center justify-center',
        'text-muted-foreground hover:text-foreground hover:bg-muted',
        'duration-fast transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
        '[&_svg]:size-icon-xs',
      )}
    >
      <Cancel01Icon aria-hidden />
    </button>
  );

  // Flags have no value — a static labelled pill with just the remove control.
  if (isFlag) {
    return (
      <span className="bg-primary-soft text-primary-soft-foreground inline-flex h-8 items-center overflow-hidden rounded-md text-xs font-medium">
        <span className="px-xs flex h-full items-center">{field.label}</span>
        <span className="bg-border h-full w-px shrink-0" aria-hidden />
        {removeButton}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(row);
        setOpen(next);
      }}
    >
      {/* Filled surface-subtle pill with a hairline border (the approved mockup
          chip): muted key + emphasized value in the clickable body, a divider,
          then the remove control — each hit area carries its own hover. A plain
          span rather than Badge: an interactive two-hit-area chip (clickable
          body + a separate remove control) is a composite, not a display Badge. */}
      <span className="border-border bg-surface-subtle inline-flex h-8 items-center overflow-hidden rounded-md border text-xs">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'gap-2xs px-xs flex h-full cursor-pointer items-center',
              'duration-fast hover:bg-muted transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
            )}
          >
            <span className="text-muted-foreground">{field.label}:</span>
            <span className="text-foreground font-medium">{chipSummary(field, row, t)}</span>
          </button>
        </PopoverTrigger>
        <span className="bg-border h-full w-px shrink-0" aria-hidden />
        {removeButton}
      </span>
      {/* Chromeless shell + the shared EDITOR_CARD — identical to the add flow,
          so the chip-edit popover matches it pixel-for-pixel. */}
      <PopoverContent className="w-auto border-0 bg-transparent p-0 shadow-none" align="start">
        <div className={EDITOR_CARD}>
          <FilterEditor
            field={field}
            row={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onCommit={() => {
              onCommit(draft);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Editor: header (label + operator) · value body · İptal / Uygula footer ──
// Uniform p-sm padding on every zone so the card reads as one tidy, roomy stack.

interface FilterEditorProps {
  field: FilterFieldDef;
  row: FilterRow;
  onChange: (patch: Partial<FilterRow>) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function FilterEditor({
  field,
  row,
  onChange,
  onCommit,
  onCancel,
}: FilterEditorProps): React.ReactElement {
  const t = useTranslations('common.advancedFilter');
  const isEnum = field.dataType === 'enumMulti' || field.dataType === 'enumFixed';
  const isRange =
    field.dataType === 'money' || field.dataType === 'number' || field.dataType === 'percent';
  const showOperator = !isEnum && field.operators.length > 1;
  const complete = isFilterRowComplete(row, field.dataType);

  return (
    <div className="flex flex-col">
      <div className="border-border gap-sm p-sm flex items-center justify-between border-b">
        <span className="text-sm font-medium">{field.label}</span>
        {showOperator ? (
          <Select
            value={row.operator}
            onValueChange={(next) => {
              if (isFilterOperator(next)) {
                onChange({ operator: next, value: convertRowValue(row, next) });
              }
            }}
          >
            <SelectTrigger size="sm" className="gap-2xs w-auto">
              <SelectValue>{t(`operators.${row.operator}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {field.operators.map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {t(`operators.${operator}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {isEnum ? (
        <MultiSelectEditor field={field} row={row} onChange={onChange} />
      ) : (
        <div className="p-sm gap-xs flex flex-col">
          <RangeOrTextEditor field={field} row={row} onChange={onChange} />
          {isRange ? <p className="text-2xs text-muted-foreground">{t('rangeHint')}</p> : null}
        </div>
      )}

      <div className="border-border p-sm gap-xs flex border-t">
        <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-2xs flex-1"
          onClick={onCommit}
          disabled={!complete}
        >
          <Tick02Icon className="size-icon-xs" aria-hidden />
          {t('apply')}
        </Button>
      </div>
    </div>
  );
}

interface ValueEditorProps {
  field: FilterFieldDef;
  row: FilterRow;
  onChange: (patch: Partial<FilterRow>) => void;
}

function RangeOrTextEditor({ field, row, onChange }: ValueEditorProps): React.ReactElement {
  const t = useTranslations('common.advancedFilter');
  const isRange =
    field.dataType === 'money' || field.dataType === 'number' || field.dataType === 'percent';
  const inputMode = field.dataType === 'number' ? 'numeric' : 'decimal';
  const leading =
    field.unit !== undefined ? <span className="text-xs">{field.unit}</span> : undefined;

  if (isRange && row.operator === 'between') {
    const [min, max] = asPair(row.value);
    return (
      <RangeInput
        min={min}
        max={max}
        onMinChange={(next) => onChange({ value: [next, max] })}
        onMaxChange={(next) => onChange({ value: [min, next] })}
        unit={field.unit}
        inputMode={inputMode}
        minLabel={t('minLabel')}
        maxLabel={t('maxLabel')}
      />
    );
  }

  return (
    <Input
      size="sm"
      inputMode={isRange ? inputMode : undefined}
      value={asString(row.value)}
      onChange={(event) => onChange({ value: event.target.value })}
      leading={isRange ? leading : undefined}
      placeholder={
        row.operator === 'gte'
          ? t('minLabel')
          : row.operator === 'lte'
            ? t('maxLabel')
            : t('valuePlaceholder')
      }
    />
  );
}

function MultiSelectEditor({ field, row, onChange }: ValueEditorProps): React.ReactElement {
  const t = useTranslations('common.advancedFilter');
  const selected = new Set(asArray(row.value));
  const options = field.enumValues ?? [];

  function toggle(optionValue: string): void {
    const next = new Set(selected);
    if (next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    onChange({ value: [...next] });
  }

  return (
    <Command>
      <CommandInput placeholder={t('selectValues')} wrapperClassName={SEARCH_WRAPPER} />
      <CommandList>
        <CommandEmpty>{t('noValues')}</CommandEmpty>
        <CommandGroup>
          {options.map((option) => {
            const checked = selected.has(option.value);
            return (
              <CommandItem
                key={option.value}
                value={option.label}
                onSelect={() => toggle(option.value)}
                aria-selected={checked}
                className="cursor-pointer"
              >
                <span
                  className={cn(
                    'border-border mr-xs flex size-4 shrink-0 items-center justify-center rounded-xs border',
                    checked && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {checked ? <Tick02Icon className="size-3" aria-hidden /> : null}
                </span>
                <span className="flex-1">{option.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

// ─── value helpers + chip summary ────────────────────────────────────────────

function freshRow(field: FilterFieldDef): FilterRow {
  return {
    id: crypto.randomUUID(),
    field: field.key,
    operator: defaultOperatorFor(field.dataType),
    value: emptyValueFor(field.dataType),
  };
}

function asString(value: FilterRow['value']): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function asArray(value: FilterRow['value']): string[] {
  return Array.isArray(value) ? value : value.length > 0 ? [value] : [];
}

function asPair(value: FilterRow['value']): [string, string] {
  if (Array.isArray(value)) return [value[0] ?? '', value[1] ?? ''];
  return [value, ''];
}

function chipSummary(
  field: FilterFieldDef,
  row: FilterRow,
  t: ReturnType<typeof useTranslations<'common.advancedFilter'>>,
): string {
  if (!isFilterRowComplete(row, field.dataType)) return t('chooseValue');

  if (field.dataType === 'enumMulti' || field.dataType === 'enumFixed') {
    const values = asArray(row.value);
    if (values.length <= 2) {
      return values
        .map((value) => field.enumValues?.find((option) => option.value === value)?.label ?? value)
        .join(', ');
    }
    return t('valuesSelected', { count: values.length });
  }

  const unit = field.unit !== undefined ? ` ${field.unit}` : '';
  const [min, max] = rangeBounds(row);
  // The unit (₺ / %) rides on each numeric bound so the value the seller typed
  // always carries its symbol; an open bound shows the infinity glyph instead.
  const lo = min !== undefined ? `${min}${unit}` : '−∞';
  const hi = max !== undefined ? `${max}${unit}` : '∞';
  switch (row.operator) {
    case 'between':
      return `${lo} – ${hi}`;
    case 'gte':
      return `≥ ${min ?? ''}${unit}`;
    case 'lte':
      return `≤ ${max ?? ''}${unit}`;
    case 'eq':
      return `= ${min ?? ''}${unit}`;
    default:
      return asString(row.value);
  }
}

function groupByLabel(fields: FilterFieldDef[]): [string, FilterFieldDef[]][] {
  const groups = new Map<string, FilterFieldDef[]>();
  for (const field of fields) {
    const existing = groups.get(field.groupLabel);
    if (existing !== undefined) existing.push(field);
    else groups.set(field.groupLabel, [field]);
  }
  return [...groups.entries()];
}
