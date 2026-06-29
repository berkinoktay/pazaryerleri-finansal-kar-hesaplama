'use client';

import { ArrowRight01Icon, Delete02Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { SelectionMap } from '../lib/bulk-actions';
import type { TariffTemplate, TariffValidity } from '../types';

export interface CommissionTariffsListProps {
  templates: readonly TariffTemplate[];
  selections: Readonly<Record<string, SelectionMap>>;
  exportedIds: Readonly<Record<string, boolean>>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}

function countDistinctProducts(template: TariffTemplate): number {
  const ids = new Set<string>();
  for (const period of template.periods) {
    for (const row of period.rows) ids.add(row.id);
  }
  return ids.size;
}

function countSelected(selection: SelectionMap | undefined): number {
  if (selection === undefined) return 0;
  return Object.values(selection).filter((band) => band !== null).length;
}

const VALIDITY_TONE: Record<TariffValidity, 'success' | 'info' | 'neutral'> = {
  active: 'success',
  upcoming: 'info',
  past: 'neutral',
};

/** Most actionable first: active → upcoming → past. */
const VALIDITY_ORDER: Record<TariffValidity, number> = {
  active: 0,
  upcoming: 1,
  past: 2,
};

/**
 * Master view: the seller's saved tariffs as a row list. Clicking a row opens
 * that tariff on its own; the trash button deletes it. The trailing dashed row
 * adds another. The empty case (no tariffs) is routed by the page to the upload
 * screen instead.
 */
export function CommissionTariffsList({
  templates,
  selections,
  exportedIds,
  onOpen,
  onDelete,
  onCreate,
}: CommissionTariffsListProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage');
  const sorted = [...templates].sort(
    (a, b) => VALIDITY_ORDER[a.validity] - VALIDITY_ORDER[b.validity],
  );

  return (
    <div className="border-border divide-border bg-card divide-y overflow-hidden rounded-xl border">
      {sorted.map((template) => {
        const productCount = countDistinctProducts(template);
        const selectedCount = countSelected(selections[template.id]);
        const pct = productCount === 0 ? 0 : Math.round((selectedCount / productCount) * 100);
        const exported = exportedIds[template.id] === true;
        return (
          <div
            key={template.id}
            role="button"
            tabIndex={0}
            aria-label={t('list.openAria', { name: template.name })}
            onClick={() => onOpen(template.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(template.id);
              }
            }}
            className={cn(
              'gap-md px-md py-sm group flex cursor-pointer flex-wrap items-center',
              'duration-fast ease-out-quart transition-colors',
              'hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{template.name}</div>
              <div className="text-2xs text-muted-foreground gap-2xs mt-3xs flex flex-wrap items-center">
                <span className="tabular-nums">
                  {t('list.productCount', { count: productCount })}
                </span>
                <span>·</span>
                <span>{t('list.periodCount', { count: template.periods.length })}</span>
                <span>·</span>
                <span>{template.updatedLabel}</span>
              </div>
            </div>

            <div className="w-36">
              <div className="text-2xs text-muted-foreground mb-3xs tabular-nums">
                {selectedCount}/{productCount}
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                {/* runtime-dynamic: selection progress width */}
                <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <Badge tone={exported ? 'success' : 'neutral'} variant="surface" size="sm">
              {exported ? t('status.exported') : t('status.pending')}
            </Badge>

            <Badge tone={VALIDITY_TONE[template.validity]} variant="surface" size="sm">
              {t(`validity.${template.validity}`)}
            </Badge>

            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  aria-label={t('templates.delete')}
                  onClick={(event) => event.stopPropagation()}
                  className="text-muted-foreground hover:text-destructive hover:bg-muted [&_svg]:size-icon-sm focus-visible:shadow-focus flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none pointer-coarse:size-11"
                >
                  <Delete02Icon aria-hidden />
                </button>
              }
              title={t('templates.deleteTitle')}
              description={t('templates.deleteDescription')}
              confirmLabel={t('templates.deleteConfirm')}
              onConfirm={() => onDelete(template.id)}
            />

            <ArrowRight01Icon
              aria-hidden
              className="size-icon-sm text-muted-foreground group-hover:text-foreground"
            />
          </div>
        );
      })}

      <button
        type="button"
        onClick={onCreate}
        className="text-primary gap-2xs px-md py-sm border-primary/30 hover:bg-primary-surface focus-visible:shadow-focus flex w-full items-center border-t border-dashed text-sm font-medium transition-colors focus-visible:outline-none"
      >
        <PlusSignIcon aria-hidden className="size-icon-sm" />
        {t('templates.add')}
      </button>
    </div>
  );
}
