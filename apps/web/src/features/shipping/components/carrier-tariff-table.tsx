'use client';

import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useCarrierTariffs } from '../hooks/use-carrier-tariffs';

export interface CarrierTariffTableProps {
  orgId: string;
  carrierId: string;
}

/**
 * Renders the current desi-bazlı tariff and (when supported) the Barem
 * desteği tier table for a single carrier. Read-only — sellers use it
 * to verify their carrier's current values inside the store settings
 * panel.
 *
 * Two sub-sections:
 *   1. Desi Bazlı Tarife — one row per desi step.
 *   2. Barem Desteği — only rendered when `carrier.supportsBaremDestek`.
 *
 * Empty/loading/error states are all expressed inline via a single
 * muted help string so the table never half-renders during a refetch.
 * Prices come down as Decimal-string KDV-hariç values; the `Currency`
 * pattern formats them with TRY conventions + tabular numerics.
 */
export function CarrierTariffTable({
  orgId,
  carrierId,
}: CarrierTariffTableProps): React.ReactElement {
  const t = useTranslations('shipping.settings.tariffTable');
  const query = useCarrierTariffs(orgId, carrierId);

  if (query.isLoading) {
    return <p className="text-muted-foreground text-xs">{t('loading')}</p>;
  }
  if (query.isError || query.data === undefined) {
    return <p className="text-destructive text-xs">{t('error')}</p>;
  }

  const { carrier, desiTariffs, baremTariffs } = query.data;
  const showBarem = carrier.supportsBaremDestek && baremTariffs.length > 0;

  return (
    <section className="gap-sm flex flex-col">
      <header className="gap-3xs flex flex-col">
        <h3 className="text-foreground text-sm font-semibold">{t('title')}</h3>
        <p className="text-muted-foreground text-xs">{t('subtitle')}</p>
      </header>

      <div className="gap-2xs flex flex-col">
        <h4 className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
          {t('desiSection')}
        </h4>
        <div className="border-border bg-card overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('desiColumn')}</TableHead>
                <TableHead data-numeric="true">{t('priceColumn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {desiTariffs.map((row) => (
                <TableRow key={row.desi}>
                  <TableCell>{row.desi}</TableCell>
                  <TableCell data-numeric="true">
                    <Currency value={row.priceNet} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {showBarem ? (
        <div className="gap-2xs flex flex-col">
          <h4 className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            {t('baremSection')}
          </h4>
          <div className="border-border bg-card overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('baremRangeColumn')}</TableHead>
                  <TableHead data-numeric="true">{t('priceColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baremTariffs.map((row) => (
                  <TableRow key={`${row.minOrderAmount}-${row.maxOrderAmount}`}>
                    <TableCell>
                      <span className="tabular-nums">
                        <Currency value={row.minOrderAmount} /> –{' '}
                        <Currency value={row.maxOrderAmount} />
                      </span>
                    </TableCell>
                    <TableCell data-numeric="true">
                      <Currency value={row.priceNet} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
