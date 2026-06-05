'use client';

import type { components } from '@pazarsync/api-client';
import { Alert02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCostProfiles } from '@/features/costs/hooks/use-cost-profiles'; // VERIFIED: args: { orgId; filters? } | null

import { useSetOrderItemCost } from '../hooks/use-set-order-item-cost';

// Source from the generated client (no cross-feature type edge).
type OrderItemDetail = components['schemas']['OrderItemDetail'];

interface CostEntryCellProps {
  orgId: string;
  storeId: string;
  orderId: string;
  item: OrderItemDetail;
}

export function CostEntryCell({
  orgId,
  storeId,
  orderId,
  item,
}: CostEntryCellProps): React.ReactElement {
  const t = useTranslations('livePerformance.orderDetail.costEntry');
  const [open, setOpen] = React.useState(false);
  const [netAmount, setNetAmount] = React.useState('');
  const [vatRate, setVatRate] = React.useState('20');
  const [profileId, setProfileId] = React.useState<string>('');
  const mutation = useSetOrderItemCost(orgId, storeId, orderId);
  const profiles = useCostProfiles({ orgId }); // UseQueryResult<{ data: CostProfile[]; meta }>

  if (item.unitCostSnapshotNet !== null) {
    return <Currency value={item.unitCostSnapshotNet} />;
  }

  const submitManual = (): void => {
    const net = Number(netAmount);
    const rate = Number(vatRate);
    if (!(net > 0) || rate < 0 || rate > 100) return;
    mutation.mutate(
      { itemId: item.id, body: { source: 'manual', netAmount, vatRate: rate } },
      { onSuccess: () => setOpen(false) },
    );
  };

  const submitProfile = (): void => {
    if (profileId === '') return;
    mutation.mutate(
      { itemId: item.id, body: { source: 'profile', profileId } },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2xs" data-row-action>
          <Alert02Icon className="size-icon-sm text-warning" />
          {t('trigger')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-input">
        <Tabs defaultValue="manual">
          <TabsList className="w-full">
            <TabsTrigger value="manual">{t('tabs.manual')}</TabsTrigger>
            <TabsTrigger value="profile">{t('tabs.profile')}</TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="gap-sm flex flex-col">
            <div className="gap-2xs flex flex-col">
              <Label htmlFor="cost-net">{t('netAmount')}</Label>
              <Input
                id="cost-net"
                inputMode="decimal"
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
              />
            </div>
            <div className="gap-2xs flex flex-col">
              <Label htmlFor="cost-vat">{t('vatRate')}</Label>
              <Input
                id="cost-vat"
                inputMode="numeric"
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
              />
            </div>
            <Button onClick={submitManual} disabled={mutation.isPending}>
              {t('save')}
            </Button>
          </TabsContent>
          <TabsContent value="profile" className="gap-sm flex flex-col">
            {(profiles.data?.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noProfiles')}</p>
            ) : (
              <>
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger aria-label={t('profile')}>
                    <SelectValue placeholder={t('profilePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(profiles.data?.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={submitProfile} disabled={mutation.isPending || profileId === ''}>
                  {t('save')}
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
