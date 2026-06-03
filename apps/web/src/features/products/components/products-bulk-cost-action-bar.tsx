'use client';

import { AddCircleIcon, Delete01Icon, RepeatIcon, WeightScaleIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { BulkActionBar } from '@/components/patterns/bulk-action-bar';
import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Combobox, type ComboboxOption } from '@/components/patterns/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CostProfileTypeBadge } from '@/features/costs/components/cost-profile-type-badge';
import { useAttachCostProfiles } from '@/features/costs/hooks/use-attach-cost-profiles';
import { useDetachCostProfiles } from '@/features/costs/hooks/use-detach-cost-profiles';
import { useReplaceCostProfiles } from '@/features/costs/hooks/use-replace-cost-profiles';
import { useCostProfiles } from '@/features/costs/hooks/use-cost-profiles';
import { CostProfileType } from '@/features/costs/types/cost-profile.types';

import { BulkDesiDialog } from './bulk-desi-dialog';
import type { ProductRow } from './products-bulk-cost-action-bar.types';

export type { ProductRow };

/**
 * Resolves the full set of variant IDs from a selection of product rows.
 *
 * - Variant rows   → use their own id directly.
 * - Parent rows    → expand to all their child variant IDs so bulk operations
 *   apply to every variant under the product.
 */
export function resolveVariantIds(rows: ProductRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.kind === 'variant') {
      ids.push(row.variant.id);
    } else {
      for (const v of row.product.variants) {
        ids.push(v.id);
      }
    }
  }
  return ids;
}

export interface ProductsBulkCostActionBarProps {
  orgId: string;
  storeId: string;
  /** Currently selected rows from the TanStack table's getSelectedRowModel().rows */
  selectedRows: ProductRow[];
  /** Clears the table's row selection state */
  onClearSelection: () => void;
}

type ActiveDialog = 'attach' | 'detach' | 'replace' | 'desi' | null;

/**
 * Floating action bar for bulk cost operations on selected products table rows.
 *
 * Visible when ≥ 2 rows are selected. Offers three operations:
 *   1. "Maliyet ekle"          → combobox → useAttachCostProfiles
 *   2. "Maliyet kaldır"        → combobox → useDetachCostProfiles
 *   3. "Maliyetleri değiştir"  → combobox + ConfirmDialog (destructive)
 *      → useReplaceCostProfiles
 *
 * Parent rows are automatically expanded to their child variant IDs via
 * `resolveVariantIds` — the seller's selection of a parent product row
 * implies intent to operate on all its variants.
 */
export function ProductsBulkCostActionBar({
  orgId,
  storeId,
  selectedRows,
  onClearSelection,
}: ProductsBulkCostActionBarProps): React.ReactElement | null {
  const t = useTranslations('products.bulkCost');
  const tDesi = useTranslations('products.bulkDesi');

  const [activeDialog, setActiveDialog] = React.useState<ActiveDialog>(null);
  const [replaceProfileId, setReplaceProfileId] = React.useState<string | null>(null);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = React.useState(false);

  const profilesQuery = useCostProfiles(
    activeDialog !== null ? { orgId, filters: { archived: 'false' } } : null,
  );

  const attachMutation = useAttachCostProfiles();
  const detachMutation = useDetachCostProfiles();
  const replaceMutation = useReplaceCostProfiles();

  const variantIds = React.useMemo(() => resolveVariantIds(selectedRows), [selectedRows]);

  const selectedCount = selectedRows.length;

  // Any cost mutation in flight drives the bar's busy state — disables every
  // action + the clear button so a seller can't double-fire or deselect mid-op.
  const busy = attachMutation.isPending || detachMutation.isPending || replaceMutation.isPending;

  // Build combobox options from the non-archived profiles list.
  const profileOptions: ComboboxOption[] = React.useMemo(() => {
    const all = profilesQuery.data?.data ?? [];
    return all.map((p) => ({
      value: p.id,
      label: p.name,
      description: `${p.currency} ${p.amount}`,
      icon: <CostProfileTypeBadge type={p.type as CostProfileType} iconOnly />,
    }));
  }, [profilesQuery.data]);

  // ─── Action handlers ────────────────────────────────────────────────────────

  function handleAttach(profileId: string | null) {
    if (profileId === null) return;
    const profile = profilesQuery.data?.data.find((p) => p.id === profileId);
    const affected = variantIds.length;
    attachMutation.mutate(
      {
        orgId,
        profileIds: [profileId],
        variantIds,
        ...(profile !== undefined ? { optimisticProfiles: [profile] } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t('toast.attached', { count: affected }));
          setActiveDialog(null);
          onClearSelection();
        },
      },
    );
  }

  function handleDetach(profileId: string | null) {
    if (profileId === null) return;
    const affected = variantIds.length;
    detachMutation.mutate(
      { orgId, profileIds: [profileId], variantIds },
      {
        onSuccess: () => {
          toast.success(t('toast.detached', { count: affected }));
          setActiveDialog(null);
          onClearSelection();
        },
      },
    );
  }

  function handleReplacePick(profileId: string | null) {
    if (profileId === null) return;
    setReplaceProfileId(profileId);
    setActiveDialog(null);
    setReplaceConfirmOpen(true);
  }

  async function handleReplaceConfirm(): Promise<void> {
    if (replaceProfileId === null) return;
    const profile = profilesQuery.data?.data.find((p) => p.id === replaceProfileId);
    const affected = variantIds.length;
    return new Promise<void>((resolve, reject) => {
      replaceMutation.mutate(
        {
          orgId,
          profileIds: [replaceProfileId],
          variantIds,
          ...(profile !== undefined ? { optimisticProfiles: [profile] } : {}),
        },
        {
          onSuccess: () => {
            toast.success(t('toast.replaced', { count: affected }));
            setReplaceProfileId(null);
            setReplaceConfirmOpen(false);
            onClearSelection();
            resolve();
          },
          onError: (error) => {
            reject(error);
          },
        },
      );
    });
  }

  // ─── BulkActionBar actions ──────────────────────────────────────────────────

  const actions = [
    {
      id: 'attach',
      label: t('attach'),
      icon: <AddCircleIcon className="size-icon-sm" />,
      onClick: () => setActiveDialog('attach'),
    },
    {
      id: 'detach',
      label: t('detach'),
      icon: <Delete01Icon className="size-icon-sm" />,
      onClick: () => setActiveDialog('detach'),
    },
    {
      id: 'replace',
      label: t('replace'),
      icon: <RepeatIcon className="size-icon-sm" />,
      onClick: () => setActiveDialog('replace'),
      tone: 'destructive' as const,
    },
    {
      id: 'desi',
      label: tDesi('actionLabel'),
      icon: <WeightScaleIcon className="size-icon-sm" />,
      onClick: () => setActiveDialog('desi'),
      // Group break visually separates the cost cluster (3 actions on the
      // left) from the dimensional-weight cluster (this action, and any
      // future per-weight bulk operations to the right of it).
      groupBreakBefore: true,
    },
  ];

  // Config for the three combobox dialogs — same structure, different strings + handler.
  const comboboxDialogs: Array<{
    id: Exclude<ActiveDialog, null>;
    titleKey: Parameters<typeof t>[0];
    placeholderKey: Parameters<typeof t>[0];
    searchKey: Parameters<typeof t>[0];
    emptyKey: Parameters<typeof t>[0];
    onChange: (id: string | null) => void;
    loading: boolean;
    disabled?: boolean;
  }> = [
    {
      id: 'attach',
      titleKey: 'attachDialog.title',
      placeholderKey: 'attachDialog.placeholder',
      searchKey: 'attachDialog.search',
      emptyKey: 'attachDialog.empty',
      onChange: handleAttach,
      loading: attachMutation.isPending || profilesQuery.isLoading,
      disabled: attachMutation.isPending,
    },
    {
      id: 'detach',
      titleKey: 'detachDialog.title',
      placeholderKey: 'detachDialog.placeholder',
      searchKey: 'detachDialog.search',
      emptyKey: 'detachDialog.empty',
      onChange: handleDetach,
      loading: detachMutation.isPending || profilesQuery.isLoading,
      disabled: detachMutation.isPending,
    },
    {
      id: 'replace',
      titleKey: 'replaceDialog.title',
      placeholderKey: 'replaceDialog.placeholder',
      searchKey: 'replaceDialog.search',
      emptyKey: 'replaceDialog.empty',
      onChange: handleReplacePick,
      loading: profilesQuery.isLoading,
    },
  ];

  return (
    <>
      <BulkActionBar
        selectedCount={selectedCount}
        onClear={onClearSelection}
        actions={actions}
        busy={busy}
        // Bulk cost ops stay a ≥2 affordance (single-product cost edits live in
        // the row's own kebab). This preserves the previous caller-gate
        // threshold now that the gate moved into the always-mounted bar so the
        // exit animation can play.
        minSelected={2}
        countLabel={(count) => t('selectedCount', { count })}
        clearLabel={t('clearSelection')}
      />

      {comboboxDialogs.map((dialog) => (
        <Dialog
          key={dialog.id}
          open={activeDialog === dialog.id}
          onOpenChange={(o) => !o && setActiveDialog(null)}
        >
          <DialogContent className="max-w-input-narrow">
            <DialogHeader>
              <DialogTitle>{t(dialog.titleKey)}</DialogTitle>
            </DialogHeader>
            <Combobox
              value={null}
              onChange={dialog.onChange}
              options={profileOptions}
              placeholder={t(dialog.placeholderKey)}
              searchPlaceholder={t(dialog.searchKey)}
              emptyMessage={t(dialog.emptyKey)}
              loading={dialog.loading}
              disabled={dialog.disabled}
            />
          </DialogContent>
        </Dialog>
      ))}

      <ConfirmDialog
        open={replaceConfirmOpen}
        onOpenChange={setReplaceConfirmOpen}
        title={t('replaceConfirm.title')}
        description={t('replaceConfirm.description', { count: variantIds.length })}
        confirmLabel={t('replaceConfirm.confirm')}
        tone="destructive"
        onConfirm={handleReplaceConfirm}
        loading={replaceMutation.isPending}
      />

      <BulkDesiDialog
        open={activeDialog === 'desi'}
        onOpenChange={(o) => setActiveDialog(o ? 'desi' : null)}
        orgId={orgId}
        storeId={storeId}
        variantIds={variantIds}
        onClearSelection={onClearSelection}
      />
    </>
  );
}
