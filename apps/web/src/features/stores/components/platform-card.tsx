'use client';

import { useTranslations } from 'next-intl';

import { MarketplaceLogo, type MarketplacePlatform } from '@/components/patterns/marketplace-logo';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type PlatformKey = MarketplacePlatform;

export interface PlatformCardProps {
  platform: PlatformKey;
  selected: boolean;
  comingSoon: boolean;
  onSelect?: () => void;
}

export function PlatformCard({
  platform,
  selected,
  comingSoon,
  onSelect,
}: PlatformCardProps): React.ReactElement {
  const tPlatforms = useTranslations('stores.platforms');
  const tStatus = useTranslations('stores.platformStatus');

  const handleClick = comingSoon ? undefined : onSelect;
  const platformName = tPlatforms(platform);

  return (
    <Card
      role="button"
      tabIndex={comingSoon ? -1 : 0}
      aria-disabled={comingSoon}
      aria-pressed={selected}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (comingSoon) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={cn(
        'p-lg duration-fast relative flex min-h-36 cursor-pointer items-center justify-center transition-all',
        'hover:border-border-strong hover:shadow-md',
        selected && !comingSoon && 'border-primary ring-primary/20 ring-2',
        comingSoon && 'cursor-not-allowed opacity-60 hover:shadow-xs',
      )}
    >
      {/* Logo is the name — wordmarks already contain the brand text,
          so the SVG does the work. The alt text keeps it announced to
          screen readers. Badge floats top-right when relevant. */}
      <MarketplaceLogo platform={platform} size="2xl" alt={platformName} />
      {comingSoon ? (
        <Badge className="text-2xs top-xs right-xs absolute">{tStatus('comingSoon')}</Badge>
      ) : null}
    </Card>
  );
}
