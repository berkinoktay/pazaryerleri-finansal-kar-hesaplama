'use client';

import { PlusSignIcon, Tick02Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterChipGroup, type FilterChip } from '@/components/patterns/filter-chip-group';
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
 * FilterFieldDef[], it renders a `+ Filtre ekle` menu and one interactive chip
 * per applied filter. Chip rendering is delegated to `FilterChipGroup` (the
 * single chip surface); this file owns the add menu and the value editors.
 * The interaction follows the approved mockup:
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

/**
 * Standalone composition: applied chips + the add button in one flex row.
 * Inside a DataTable, prefer the toolbar's `advancedFilter` prop, which
 * mounts `AdvancedFilterAddButton` in the control row and
 * `AdvancedFilterChips` as its own row beneath it.
 */
export function AdvancedFilterMenu({
  fields,
  value,
  onApply,
}: AdvancedFilterMenuProps): React.ReactElement {
  return (
    <div className="gap-xs flex flex-wrap items-center">
      <AdvancedFilterChips fields={fields} value={value} onApply={onApply} />
      <AdvancedFilterAddButton fields={fields} value={value} onApply={onApply} />
    </div>
  );
}

// Add (append) or replace a row by id, producing the full next set.
function withRow(value: FilterRow[], row: FilterRow): FilterRow[] {
  const exists = value.some((existing) => existing.id === row.id);
  return exists
    ? value.map((existing) => (existing.id === row.id ? row : existing))
    : [...value, row];
}

/** The `+ Filtre ekle` trigger alone — the toolbar mounts this in its control row. */
export function AdvancedFilterAddButton({
  fields,
  value,
  onApply,
}: AdvancedFilterMenuProps): React.ReactElement {
  const usedKeys = new Set(value.map((row) => row.field));
  return (
    <AddFilterButton
      fields={fields}
      usedKeys={usedKeys}
      onCommit={(row) => onApply(withRow(value, row))}
    />
  );
}

export interface AdvancedFilterChipsProps extends AdvancedFilterMenuProps {
  /** Renders the "Clear all" link at the end of the chip row. */
  onClearAll?: () => void;
  className?: string;
}

/**
 * Applied filters as a FilterChipGroup row — the single chip surface.
 * Each non-flag chip is click-to-edit: the body opens the same value
 * editor card as the add flow; ✕ removes the row. Editing state lives
 * here (one editor open at a time), the committed value stays with the
 * caller (URL via nuqs).
 */
export function AdvancedFilterChips({
  fields,
  value,
  onApply,
  onClearAll,
  className,
}: AdvancedFilterChipsProps): React.ReactElement | null {
  const t = useTranslations('common.advancedFilter');
  const formatter = useFormatter();
  const fieldByKey = React.useMemo(
    () => new Map(fields.map((field) => [field.key, field])),
    [fields],
  );

  // One chip edits at a time. The draft buffers the in-progress edit so
  // İptal / Escape discards it; it re-seeds from the committed row on open.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<FilterRow | null>(null);

  function closeEditor(): void {
    setEditingId(null);
    setDraft(null);
  }

  // Reconcile: if the edited row left `value` WITHOUT a close event (e.g.
  // browser Back on a page whose filters are URL-owned via nuqs), Radix never
  // fires onOpenChange(false) — the chip just unmounts — and editingId/draft
  // would leak. When the same row id later returns (browser Forward), the
  // editor would spontaneously reopen carrying the abandoned draft, and Uygula
  // would commit it. Drop the leaked state during render (React's "adjusting
  // state when props change" pattern — an effect would flash the open editor
  // for a frame first).
  if (editingId !== null && !value.some((row) => row.id === editingId)) {
    setEditingId(null);
    setDraft(null);
  }

  const chips: FilterChip[] = value.flatMap((row) => {
    const field = fieldByKey.get(row.field);
    if (field === undefined) return [];
    const isFlag = field.dataType === 'flag';
    const editedRow = editingId === row.id && draft !== null ? draft : row;

    return [
      {
        id: row.id,
        group: isFlag ? undefined : field.label,
        label: isFlag ? field.label : chipSummary(field, row, t, formatter),
        onRemove: () => onApply(value.filter((existing) => existing.id !== row.id)),
        removeLabel: t('removeFilter'),
        // Flags carry no value — nothing to edit, the chip stays static.
        editor: isFlag
          ? undefined
          : {
              open: editingId === row.id,
              onOpenChange: (next: boolean) => {
                if (next) {
                  setDraft(row);
                  setEditingId(row.id);
                } else {
                  closeEditor();
                }
              },
              // Chromeless shell + the shared EDITOR_CARD — identical to the
              // add flow, so the chip-edit popover matches it pixel-for-pixel.
              contentClassName: 'w-auto border-0 bg-transparent p-0 shadow-none',
              content: (
                <div className={EDITOR_CARD}>
                  <FilterEditor
                    field={field}
                    row={editedRow}
                    onChange={(patch) =>
                      setDraft((current) => (current !== null ? { ...current, ...patch } : current))
                    }
                    onCommit={() => {
                      if (draft !== null) onApply(withRow(value, draft));
                      closeEditor();
                    }}
                    onCancel={closeEditor}
                  />
                </div>
              ),
            },
      },
    ];
  });

  return <FilterChipGroup chips={chips} onClearAll={onClearAll} className={className} />;
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
  const isEnumSingle = field.dataType === 'enumSingle';
  const isRange =
    field.dataType === 'money' || field.dataType === 'number' || field.dataType === 'percent';
  const showOperator = !isEnum && !isEnumSingle && field.operators.length > 1;
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
      ) : isEnumSingle ? (
        <SingleSelectEditor field={field} row={row} onChange={onChange} />
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

/**
 * Radio-semantics counterpart of MultiSelectEditor for `enumSingle` fields —
 * picking an option REPLACES the previous one (the backend param accepts a
 * single value, e.g. product status). Picking the current option clears it.
 */
function SingleSelectEditor({ field, row, onChange }: ValueEditorProps): React.ReactElement {
  const t = useTranslations('common.advancedFilter');
  const current = asString(row.value);
  const options = field.enumValues ?? [];

  return (
    <Command>
      <CommandInput placeholder={t('selectValues')} wrapperClassName={SEARCH_WRAPPER} />
      <CommandList>
        <CommandEmpty>{t('noValues')}</CommandEmpty>
        <CommandGroup>
          {options.map((option) => {
            const checked = current === option.value;
            return (
              <CommandItem
                key={option.value}
                value={option.label}
                onSelect={() => onChange({ value: checked ? '' : option.value })}
                aria-selected={checked}
                className="cursor-pointer"
              >
                <span
                  className={cn(
                    'border-border mr-xs flex size-4 shrink-0 items-center justify-center rounded-full border',
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
  // The FIELD's first operator, not the dataType default: a catalog may
  // restrict the list (e.g. a gte-only percent bound). With one operator the
  // editor hides the operator Select entirely, so a fresh row born with the
  // dataType default ('between') would be uncorrectable — its max input a
  // silent no-op against a gte-shaped adapter.
  return {
    id: crypto.randomUUID(),
    field: field.key,
    operator: field.operators[0] ?? defaultOperatorFor(field.dataType),
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

/**
 * A numeric bound rendered with its unit, matching the app-wide display
 * conventions: money through the shared `currency` format preset (`₺250,00` —
 * the same output as the `Currency` cells in the table below the chips, never
 * a hand-built `250 ₺`), percent with the Turkish prefix (`%10`). A bound the
 * user is still typing (not yet numeric) falls back to the raw text.
 */
function formatBound(
  bound: string,
  unit: FilterFieldDef['unit'],
  formatter: ReturnType<typeof useFormatter>,
): string {
  if (unit === undefined) return bound;
  if (unit === '%') return `%${bound}`;
  const numeric = Number(bound);
  return Number.isNaN(numeric) ? `${bound} ${unit}` : formatter.number(numeric, 'currency');
}

function chipSummary(
  field: FilterFieldDef,
  row: FilterRow,
  t: ReturnType<typeof useTranslations<'common.advancedFilter'>>,
  formatter: ReturnType<typeof useFormatter>,
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

  if (field.dataType === 'enumSingle') {
    const value = asString(row.value);
    return field.enumValues?.find((option) => option.value === value)?.label ?? value;
  }

  const [min, max] = rangeBounds(row);
  // The unit (₺ / %) rides on each numeric bound so the value the seller typed
  // always carries its symbol; an open bound shows the infinity glyph instead.
  const lo = min !== undefined ? formatBound(min, field.unit, formatter) : '−∞';
  const hi = max !== undefined ? formatBound(max, field.unit, formatter) : '∞';
  switch (row.operator) {
    case 'between':
      return `${lo} – ${hi}`;
    case 'gte':
      return `≥ ${min !== undefined ? formatBound(min, field.unit, formatter) : ''}`;
    case 'lte':
      return `≤ ${max !== undefined ? formatBound(max, field.unit, formatter) : ''}`;
    case 'eq':
      return `= ${min !== undefined ? formatBound(min, field.unit, formatter) : ''}`;
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
