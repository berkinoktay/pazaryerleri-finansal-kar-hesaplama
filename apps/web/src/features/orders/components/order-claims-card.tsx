'use client';

import { ReverseWithdrawal01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { type OrderClaimDetail } from '../api/get-order.api';

export interface OrderClaimsCardProps {
  claims: OrderClaimDetail[];
}

/**
 * Return-claim overview. The PR-13 GetClaims worker has not landed yet, so
 * the canonical state for V1 orders is an empty array — the empty state
 * tells the seller this surface exists and what will live here.
 */
export function OrderClaimsCard({ claims }: OrderClaimsCardProps): React.ReactElement {
  const t = useTranslations('orderDetail.claims');
  const formatter = useFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {claims.length === 0 ? (
          <EmptyState
            icon={ReverseWithdrawal01Icon}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        ) : (
          <ul className="space-y-sm">
            {claims.map((claim) => (
              <li key={claim.id} className="border-border p-md rounded-md border">
                <div className="gap-sm flex items-center justify-between">
                  <div className="gap-3xs flex flex-col">
                    <span className="font-medium tabular-nums">{claim.trendyolClaimId}</span>
                    <span className="text-2xs text-muted-foreground tabular-nums">
                      {formatter.dateTime(new Date(claim.claimDate), 'short')}
                    </span>
                  </div>
                  <Badge tone={claim.resolved ? 'success' : 'warning'} size="sm">
                    {t(claim.resolved ? 'resolved' : 'open')}
                  </Badge>
                </div>
                {claim.cargoProviderName !== null || claim.cargoTrackingNumber !== null ? (
                  <p className="text-2xs text-muted-foreground mt-xs tabular-nums">
                    {t('cargo')}: {claim.cargoProviderName ?? '—'}
                    {claim.cargoTrackingNumber !== null ? ` · ${claim.cargoTrackingNumber}` : ''}
                  </p>
                ) : null}
                {claim.items.length > 0 ? (
                  <ul className="mt-sm gap-3xs flex flex-col">
                    {claim.items.map((item) => (
                      <li
                        key={item.id}
                        className="text-2xs text-muted-foreground gap-xs flex items-center"
                      >
                        <span>{item.reasonName}</span>
                        {item.acceptedBySeller ? (
                          <Badge tone="success" size="sm">
                            {t('accepted')}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
