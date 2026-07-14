import type { MemberRole } from '@pazarsync/db/enums';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MappedBadge } from '@/components/patterns/mapped-badge';
import { type BadgeProps } from '@/components/ui/badge';

/**
 * MemberRole → role chip. The single shared mapping for every surface that
 * shows a member/org role (the members table, the org/store switcher, the
 * settings summary cards), so tone + label stay in lockstep across the app
 * instead of drifting between copies.
 *
 * OWNER is deliberately `solid` (not Badge's `surface` default): on a soft,
 * tinted row background (e.g. the switcher's previewed org row on
 * `bg-primary-soft`) a `primary/surface` chip melts into the background and
 * reads as plain text. A solid fill keeps it legible on every surface.
 *
 * @useWhen rendering a member/org role as a Badge (members table, org/store switcher, account/org summary cards)
 */

const ROLE_TONE: Record<MemberRole, BadgeProps['tone']> = {
  OWNER: 'primary',
  ADMIN: 'neutral',
  MEMBER: 'neutral',
  VIEWER: 'neutral',
};

const ROLE_VARIANT: Partial<Record<MemberRole, BadgeProps['variant']>> = {
  OWNER: 'solid',
  MEMBER: 'outline',
  VIEWER: 'outline',
};

export interface RoleBadgeProps {
  /** The member/org role to render. */
  role: MemberRole;
  /** Vertical size of the chip. Forwarded to `Badge` (defaults to Badge's `md`). */
  size?: BadgeProps['size'];
  className?: string;
}

export function RoleBadge({ role, size, className }: RoleBadgeProps): React.ReactElement {
  const t = useTranslations('common.roles');
  const labelMap: Record<MemberRole, string> = {
    OWNER: t('owner'),
    ADMIN: t('admin'),
    MEMBER: t('member'),
    VIEWER: t('viewer'),
  };
  return (
    <MappedBadge
      value={role}
      toneMap={ROLE_TONE}
      variantMap={ROLE_VARIANT}
      labelMap={labelMap}
      size={size}
      className={className}
    />
  );
}
