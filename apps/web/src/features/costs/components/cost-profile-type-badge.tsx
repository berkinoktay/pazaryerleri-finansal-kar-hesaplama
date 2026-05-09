'use client';

import {
  DeliveryTruck01Icon,
  FactoryIcon,
  Megaphone01Icon,
  Package01Icon,
  SaleTag01Icon,
  LaptopProgrammingIcon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

import { CostProfileType } from '../types/cost-profile.types';

// ─── Icon + tone config ──────────────────────────────────────────────────────
// Static config object over a switch chain (CLAUDE.md: Dynamic Mapping Over
// Repetition). Enums come from @pazarsync/db/enums — no string literals.

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive' | 'primary';

interface TypeConfig {
  Icon: React.ComponentType<{ className?: string }>;
  tone: BadgeTone;
}

const COST_PROFILE_TYPE_CONFIG: Record<CostProfileType, TypeConfig> = {
  [CostProfileType.COGS]: { Icon: FactoryIcon, tone: 'neutral' },
  [CostProfileType.PACKAGING]: { Icon: Package01Icon, tone: 'info' },
  [CostProfileType.SHIPPING]: { Icon: DeliveryTruck01Icon, tone: 'success' },
  [CostProfileType.SOFTWARE]: { Icon: LaptopProgrammingIcon, tone: 'primary' },
  [CostProfileType.MARKETING]: { Icon: Megaphone01Icon, tone: 'warning' },
  [CostProfileType.OTHER]: { Icon: SaleTag01Icon, tone: 'neutral' },
} as const;

export interface CostProfileTypeBadgeProps {
  type: CostProfileType;
  /** When true, renders only the icon without a label (e.g. inside tight table cells). */
  iconOnly?: boolean;
}

/**
 * Badge chip showing the cost profile's type with a semantic icon and tone.
 * Composed from `Badge` primitive + Hugeicons — no new primitives forked.
 *
 * @useWhen displaying a CostProfileType as a recognizable labeled chip or icon-only indicator
 */
export function CostProfileTypeBadge({
  type,
  iconOnly = false,
}: CostProfileTypeBadgeProps): React.ReactElement {
  const t = useTranslations('costs.types');
  const config = COST_PROFILE_TYPE_CONFIG[type];

  return (
    <Badge
      tone={config.tone}
      size="sm"
      radius="md"
      leadingIcon={<config.Icon className="size-icon-xs" />}
    >
      {iconOnly ? null : t(type)}
    </Badge>
  );
}

/**
 * Returns only the Hugeicons component for a given CostProfileType —
 * used in form selects and other places that need the icon without a badge wrapper.
 */
export function getCostProfileTypeIcon(
  type: CostProfileType,
): React.ComponentType<{ className?: string }> {
  return COST_PROFILE_TYPE_CONFIG[type].Icon;
}
