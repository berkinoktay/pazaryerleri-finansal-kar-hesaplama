'use client';

import * as React from 'react';

import { CopyableValue } from '@/components/patterns/copyable-value';

const EMPTY_VALUE = '—';

interface LabeledIdentifierProps {
  /** Decorative, muted label that names the identifier (e.g. "SKU", "Barkod"). */
  label: string;
  /** Identifier value. Empty / null / undefined render a muted dash, not a copy target. */
  value: string | null | undefined;
}

/**
 * One inline "label · {value}" pair under a product name. The whole value
 * is the copy click target via `CopyableValue` (which carries
 * `data-row-action`, so the click never activates a surrounding row). When
 * the value is missing — empty string, null, or undefined — a muted em-dash
 * stands in and is NOT copyable, so the layout stays scannable without an
 * orphan copy button.
 *
 * Feature-local because `features/products` keeps its own private
 * `LabeledIdentifier` that we can't import across the feature boundary.
 */
export function LabeledIdentifier({ label, value }: LabeledIdentifierProps): React.ReactElement {
  const isMissing = value === null || value === undefined || value.length === 0;

  return (
    <span className="gap-2xs flex min-w-0 items-baseline">
      {/* Trailing colon belongs to the layout, not the i18n value — so the
          label reads "SKU:" / "Barkod:" while the copy aria-label stays clean. */}
      <span className="text-muted-foreground text-2xs shrink-0">{label}:</span>
      {isMissing ? (
        <span className="text-muted-foreground-dim text-xs tabular-nums">{EMPTY_VALUE}</span>
      ) : (
        <CopyableValue value={value} label={label} className="min-w-0">
          <span className="text-foreground truncate text-xs tabular-nums">{value}</span>
        </CopyableValue>
      )}
    </span>
  );
}
