'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import { formatCarrierChip } from '@/features/shipping/lib/format-carrier-chip';
import type {
  ShippingEstimateStatus,
  ShippingTariffApplied,
} from '@/features/shipping/types/shipping.types';
import { cn } from '@/lib/utils';

/**
 * Data contract for the net-profit popover. The cell projects every
 * field it needs in one shape so the popover doesn't reach back into
 * the variant. `null` is the canonical "missing" value across the
 * five `ShippingEstimateStatus` lanes — the popover never renders
 * `undefined`.
 *
 * `storeSettingsHref` / `variantEditHref` are pre-computed at the call
 * site so this component stays presentational (no `useParams`, no
 * `useOrgContext`). The cell knows whether the seller can navigate to
 * each one — V1 always uses them.
 */
export interface NetProfitPopoverData {
  status: ShippingEstimateStatus;
  salePrice: string;
  currentCostTry: string | null;
  commissionAmount: string | null;
  commissionRate: string | null;
  estimatedShippingNet: string | null;
  shippingCarrierCode: string | null;
  shippingTariffApplied: ShippingTariffApplied | null;
  netProfit: string | null;
  storeSettingsHref: string;
  variantEditHref: string;
}

/**
 * Renders one of two popover layouts based on `status`:
 *  - OK     → full Satış − Maliyet − Kargo − Komisyon = Net Kar table
 *  - non-OK → reason + CTA (link or disabled chip for OWN_CONTRACT_EMPTY)
 *
 * The popover is intentionally narrow (no nested controls). The CTA
 * dispatches navigation back to the seller's fix path; this component
 * neither mutates state nor closes the popover — the parent owns
 * Popover state.
 */
export function NetProfitPopover(props: NetProfitPopoverData): React.ReactElement {
  if (props.status === 'OK') {
    return <HappyPopover {...props} />;
  }
  return <ErrorPopover {...props} />;
}

function HappyPopover(props: NetProfitPopoverData): React.ReactElement {
  const t = useTranslations('shipping.products');
  const chip = formatCarrierChip(props.shippingCarrierCode, props.shippingTariffApplied);
  const commissionLabel =
    props.commissionRate !== null && props.commissionRate.length > 0
      ? `− ${t('rows.commission')} (%${props.commissionRate})`
      : `− ${t('rows.commission')}`;
  const shippingLabel =
    chip !== null ? `− ${t('rows.shipping')} · ${chip}` : `− ${t('rows.shipping')}`;

  return (
    <div className="gap-xs flex flex-col text-sm">
      <div className="text-muted-foreground text-2xs mb-2xs font-semibold tracking-wide uppercase">
        {t('popoverTitle')}
      </div>
      <Row label={t('rows.salePrice')} value={props.salePrice} />
      <Row label={`− ${t('rows.cost')}`} value={props.currentCostTry} />
      <Row label={shippingLabel} value={props.estimatedShippingNet} />
      <Row label={commissionLabel} value={props.commissionAmount} />
      <div className="border-border mt-xs pt-xs border-t">
        <Row label={t('rows.netProfit')} value={props.netProfit} emphasis />
      </div>
    </div>
  );
}

function ErrorPopover(props: NetProfitPopoverData): React.ReactElement | null {
  const t = useTranslations('shipping.products');
  // `status` is narrowed by the outer dispatch — guarded again here so
  // the i18n keys are statically typed.
  if (props.status === 'OK') return null;
  const titleKey = `states.${props.status}.title` as const;
  const reasonKey = `states.${props.status}.reason` as const;
  const ctaKey = `states.${props.status}.cta` as const;

  const disabled = props.status === 'OWN_CONTRACT_EMPTY';
  const href = props.status === 'NO_DESI' ? props.variantEditHref : props.storeSettingsHref;

  return (
    <div className="gap-sm flex flex-col text-sm">
      <div className="text-foreground text-sm font-semibold">{t(titleKey)}</div>
      <p className="text-muted-foreground text-xs">{t(reasonKey)}</p>
      {disabled ? (
        <span className="bg-muted text-muted-foreground px-xs py-3xs self-start rounded-xs text-xs">
          {t(ctaKey)}
        </span>
      ) : (
        <Link
          href={href}
          className="text-primary text-xs font-medium hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {t(ctaKey)} →
        </Link>
      )}
    </div>
  );
}

interface RowProps {
  label: string;
  value: string | null;
  emphasis?: boolean;
}

/**
 * One row inside the happy breakdown: left label, right TRY-formatted
 * value. Null falls back to "—" (consistent with the rest of the
 * products table). `emphasis` is used for the final Net Kar row which
 * also lives inside a top-bordered footer (handled by the caller).
 */
function Row({ label, value, emphasis = false }: RowProps): React.ReactElement {
  const formatter = useFormatter();
  const displayValue =
    value === null ? '—' : formatter.number(Number.parseFloat(value), 'currency');
  return (
    <div className="gap-md flex items-baseline justify-between">
      <span
        className={cn(
          'text-xs',
          emphasis ? 'text-foreground font-semibold' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-sm tabular-nums',
          emphasis ? 'text-success font-semibold' : 'text-foreground',
        )}
      >
        {displayValue}
      </span>
    </div>
  );
}
