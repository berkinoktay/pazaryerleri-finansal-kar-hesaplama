'use client';

import {
  DeliveryTruck01Icon,
  FactoryIcon,
  LaptopProgrammingIcon,
  Megaphone01Icon,
  Package01Icon,
  SaleTag01Icon,
} from 'hugeicons-react';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { cn } from '@/lib/utils';

import { CostProfileType } from '../types/cost-profile.types';

// ─── Type → icon + surface mapping ───────────────────────────────────────────
// Two parallel records: the icon component AND its tinted surface class.
// Member access (`TYPE_CONFIG[type].Icon`) keeps the React Compiler happy —
// see cost-profile-type-badge.tsx for the same pattern. A local const
// `const Icon = TYPE_CONFIG[type].Icon` followed by `<Icon />` would trip
// the "Cannot create components during render" rule.

interface TypeGlyph {
  Icon: React.ComponentType<{ className?: string }>;
  surface: string;
}

const TYPE_CONFIG: Record<CostProfileType, TypeGlyph> = {
  [CostProfileType.COGS]: { Icon: FactoryIcon, surface: 'bg-muted text-foreground' },
  [CostProfileType.PACKAGING]: { Icon: Package01Icon, surface: 'bg-info-surface text-info' },
  [CostProfileType.SHIPPING]: {
    Icon: DeliveryTruck01Icon,
    surface: 'bg-success-surface text-success',
  },
  [CostProfileType.SOFTWARE]: {
    Icon: LaptopProgrammingIcon,
    surface: 'bg-primary/10 text-primary',
  },
  [CostProfileType.MARKETING]: {
    Icon: Megaphone01Icon,
    surface: 'bg-warning-surface text-warning',
  },
  [CostProfileType.OTHER]: { Icon: SaleTag01Icon, surface: 'bg-muted text-foreground' },
};

export interface CostProfileTypeIconSquareProps {
  type: CostProfileType;
  className?: string;
}

/**
 * Compact 24×24 tinted square containing the cost-profile-type icon.
 * Use inside dense list rows (popover attached lists, cmdk results)
 * where `CostProfileTypeBadge iconOnly` reads as too chunky.
 *
 * @useWhen rendering a cost-profile type marker inside a tight row layout
 */
export function CostProfileTypeIconSquare({
  type,
  className,
}: CostProfileTypeIconSquareProps): React.ReactElement {
  const config = TYPE_CONFIG[type];
  return (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-sm',
        config.surface,
        className,
      )}
      aria-hidden="true"
    >
      <config.Icon className="size-icon-xs" />
    </span>
  );
}

// ─── Profile amount ─────────────────────────────────────────────────────────

export interface ProfileAmountProps {
  amount: string;
  className?: string;
}

/**
 * Renders a cost-profile amount in TL via `<Currency>` (₺ symbol + Turkish
 * locale). Use anywhere a profile's amount needs to be displayed in a row
 * alongside other identifiers (popover attached list, cmdk result).
 */
export function ProfileAmount({ amount, className }: ProfileAmountProps): React.ReactElement {
  return <Currency value={amount} className={className} />;
}
