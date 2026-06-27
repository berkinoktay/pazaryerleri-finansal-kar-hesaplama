'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

interface CategoryRow {
  key: string;
  rate: string;
}

const CATEGORY_ROWS: CategoryRow[] = [
  { key: 'electronics', rate: '9,00' },
  { key: 'clothing', rate: '23,64' },
  { key: 'homeLife', rate: '14,00' },
  { key: 'cosmetics', rate: '18,00' },
  { key: 'sports', rate: '12,00' },
  { key: 'books', rate: '5,00' },
] as const;

const SELLER_LEVEL_OPTIONS = ['level1', 'level2', 'level3'] as const;
type SellerLevelOption = (typeof SELLER_LEVEL_OPTIONS)[number];

/**
 * Main column of the Komisyon (Commission) settings page.
 *
 * Two cards:
 *  1. "Satıcı seviyesi" — a Select showing the current seller level.
 *     Level affects which commission rates apply, but the backend for
 *     persisting this is not wired yet (DRAFT).
 *  2. "Kategori komisyon oranları" — a read-only reference table of
 *     representative category rates, with an import / save action
 *     that is also DRAFT.
 *
 * Both cards surface a FeatureStatusMarker and fire a `draftActionToast`
 * on any primary action — never faking a success response.
 */
export function CommissionSettings(): React.ReactElement {
  const t = useTranslations('settings.commission');
  const tStatus = useTranslations('featureStatus');

  const [sellerLevel, setSellerLevel] = useState<SellerLevelOption>('level1');

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  return (
    <>
      {/* Card 1: Satıcı seviyesi */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.sellerLevel />}
          title={t('sellerLevel.title')}
          description={t('sellerLevel.description')}
          status="draft"
        />

        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            notifyDraft();
          }}
        >
          <CardContent>
            <div className="gap-3xs max-w-form flex flex-col">
              <span className="text-foreground text-sm font-medium">{t('sellerLevel.label')}</span>
              <Select
                value={sellerLevel}
                onValueChange={(value) => {
                  setSellerLevel(value as SellerLevelOption);
                }}
              >
                <SelectTrigger aria-label={t('sellerLevel.label')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELLER_LEVEL_OPTIONS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {t(`sellerLevel.${level}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit">{t('categoryRates.saveButton')}</Button>
          </CardFooter>
        </form>
      </Card>

      {/* Card 2: Kategori komisyon oranları */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.categoryRates />}
          title={t('categoryRates.title')}
          description={t('categoryRates.description')}
          status="draft"
        />

        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('categoryRates.colCategory')}</TableHead>
                <TableHead data-numeric="true">{t('categoryRates.colRate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CATEGORY_ROWS.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    {t(`categoryRates.categories.${row.key}` as Parameters<typeof t>[0])}
                  </TableCell>
                  <TableCell data-numeric="true" className="text-muted-foreground tabular-nums">
                    {row.rate}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="button" variant="outline" onClick={notifyDraft}>
            {t('categoryRates.importButton')}
          </Button>
          <Button type="button" onClick={notifyDraft}>
            {t('categoryRates.saveButton')}
          </Button>
        </CardFooter>
      </Card>
    </>
  );
}
