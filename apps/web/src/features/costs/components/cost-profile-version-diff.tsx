'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import type { CostProfileVersion } from '../types/cost-profile.types';

// ─── Field display helpers ───────────────────────────────────────────────────

/** Human-readable label per field key. Resolved via i18n. */
const FIELD_KEYS = [
  'name',
  'type',
  'amount',
  'currency',
  'vatRate',
  'fxRateMode',
  'manualFxRate',
  'note',
  'archivedAt',
] as const;

type VersionField = (typeof FIELD_KEYS)[number];

function isVersionField(key: string): key is VersionField {
  return (FIELD_KEYS as readonly string[]).includes(key);
}

function getFieldValue(version: CostProfileVersion, field: VersionField): string {
  const raw = version[field as keyof CostProfileVersion];
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface CostProfileVersionDiffProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The version to display the diff for. When it is version 1 (initial
   * create), all fields are shown with an "İlk değer" label instead of
   * a before/after pair.
   */
  version: CostProfileVersion;
  /**
   * The previous version snapshot used to build the before column.
   * Null when this is the initial create version (version === 1).
   */
  previousVersion: CostProfileVersion | null;
}

/**
 * Sheet showing field-level diff between two cost profile versions.
 *
 * For v1 (initial create): every non-null field renders with "İlk değer"
 * instead of before/after so the user understands these are the starting
 * values.
 *
 * For v2+: only the changedFields are shown, each with a before (from
 * previousVersion) and after (from version) value.
 *
 * @useWhen displaying the field-level diff for a single cost profile version
 */
export function CostProfileVersionDiff({
  open,
  onOpenChange,
  version,
  previousVersion,
}: CostProfileVersionDiffProps): React.ReactElement {
  const t = useTranslations('costs.detail.history');
  const isInitialCreate = version.version === 1;

  const diffRows: Array<{
    field: VersionField;
    before: string | null;
    after: string;
  }> = React.useMemo(() => {
    if (isInitialCreate) {
      return FIELD_KEYS.filter((f) => {
        const val = version[f as keyof CostProfileVersion];
        return val !== null && val !== undefined;
      }).map((field) => ({ field, before: null, after: getFieldValue(version, field) }));
    }

    return version.changedFields.filter(isVersionField).map((field) => ({
      field,
      before: previousVersion !== null ? getFieldValue(previousVersion, field) : '—',
      after: getFieldValue(version, field),
    }));
  }, [isInitialCreate, version, previousVersion]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-sheet sm:max-w-sheet-wide w-full">
        <SheetHeader>
          <SheetTitle>{t('diffSheet.title', { version: version.version })}</SheetTitle>
        </SheetHeader>

        <div className="gap-md mt-lg flex flex-col">
          {diffRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">—</p>
          ) : (
            diffRows.map(({ field, before, after }) => (
              <div key={field} className="gap-2xs flex flex-col">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {t(`fields.${field}`)}
                </span>

                {before === null ? (
                  <div className="gap-xs flex items-center">
                    <Badge tone="info" size="sm">
                      {t('diffSheet.setInitial')}
                    </Badge>
                    <span className="text-foreground font-mono text-sm">{after}</span>
                  </div>
                ) : (
                  <div className="gap-sm flex flex-col">
                    <div className="gap-xs flex items-baseline">
                      <span className="text-muted-foreground w-12 shrink-0 text-xs">
                        {t('diffSheet.before')}
                      </span>
                      <span className="text-muted-foreground font-mono text-sm line-through">
                        {before}
                      </span>
                    </div>
                    <div className="gap-xs flex items-baseline">
                      <span className="text-foreground w-12 shrink-0 text-xs">
                        {t('diffSheet.after')}
                      </span>
                      <span className="text-foreground font-mono text-sm font-medium">{after}</span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
