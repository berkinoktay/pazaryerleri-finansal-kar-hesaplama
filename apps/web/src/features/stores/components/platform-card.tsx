'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export type PlatformKey = 'TRENDYOL' | 'HEPSIBURADA';

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
        'gap-xs p-md flex min-h-20 cursor-pointer flex-col items-start justify-center transition-colors',
        selected && !comingSoon && 'border-primary ring-primary/20 ring-2',
        comingSoon && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-foreground text-base font-semibold">{tPlatforms(platform)}</span>
        {comingSoon ? <Badge>{tStatus('comingSoon')}</Badge> : null}
      </div>
    </Card>
  );
}
