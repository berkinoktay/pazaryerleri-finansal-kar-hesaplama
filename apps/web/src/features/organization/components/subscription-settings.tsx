'use client';

import { CheckmarkCircle01Icon, Download04Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvoiceType = 'individual' | 'corporate';

interface BillingFormValues {
  fullName: string;
  companyName: string;
  tcKimlik: string;
  vkn: string;
  address: string;
  city: string;
  district: string;
  postalCode: string;
}

// ---------------------------------------------------------------------------
// Placeholder constants — replaced once billing backend lands
// ---------------------------------------------------------------------------

const STORE_USED = 3;
const STORE_LIMIT = 5;

/** Representative invoice rows — replaced once billing backend ships. */
const PLACEHOLDER_INVOICES = [
  { id: 'INV-2026-001', date: '01 Haz 2026', amount: '999,00', status: 'paid' as const },
  { id: 'INV-2026-002', date: '01 May 2026', amount: '999,00', status: 'paid' as const },
  { id: 'INV-2026-003', date: '01 Nis 2026', amount: '999,00', status: 'paid' as const },
] as const;

/**
 * Main column of the Abonelik page. Renders four sections:
 *
 * 1. 2-column plan + payment row — `bg-primary-soft` tinted plan card (lg:col-span-2)
 *    + payment method card (lg:col-span-1).
 * 2. Fatura bilgileri — billing type radio + form fields (unchanged).
 * 3. Fatura geçmişi — 3-row invoice table with download actions.
 *
 * ALL blocks are `draft` — save/action handlers surface a "coming soon" toast.
 * Swap handlers for real mutations once the billing API lands.
 */
export function SubscriptionSettings(): React.ReactElement {
  const t = useTranslations('settings.subscription');
  const tStatus = useTranslations('featureStatus');

  const [autoRenew, setAutoRenew] = useState(true);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('individual');

  const billingForm = useForm<BillingFormValues>({
    defaultValues: {
      fullName: '',
      companyName: '',
      tcKimlik: '',
      vkn: '',
      address: '',
      city: '',
      district: '',
      postalCode: '',
    },
  });

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  // ---------------------------------------------------------------------------
  // 1. Plan card + Payment card (2-column grid)
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Top row — plan (2/3 wide) + payment (1/3 wide) */}
      <div className="gap-lg grid lg:grid-cols-3">
        {/* LEFT: Plan card */}
        <Card className="bg-primary-soft border-border lg:col-span-2">
          <SettingsCardHeader
            icon={<DOMAIN_ICONS.plan />}
            iconTone="primary"
            title={t('plan.title')}
            status="draft"
            actions={
              <Badge tone="primary" variant="surface">
                {t('plan.currentBadge')}
              </Badge>
            }
          />

          <CardContent className="gap-lg flex flex-col">
            {/* Price + plan name */}
            <div className="gap-xs flex items-end">
              <span className="text-foreground text-3xl font-bold tabular-nums">
                ₺{t('plan.price')}
              </span>
              <span className="text-muted-foreground pb-2xs text-sm">{t('plan.pricePer')}</span>
            </div>

            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-xl font-semibold">{t('plan.planName')}</span>
              <span className="text-muted-foreground text-sm">{t('plan.currentDescription')}</span>
            </div>

            {/* Store usage feature row */}
            <div className="gap-md flex flex-col">
              <div className="gap-xs flex items-center text-sm">
                <CheckmarkCircle01Icon aria-hidden className="text-primary size-icon-sm shrink-0" />
                <span className="text-foreground">
                  {t('plan.storeFeature', { used: STORE_USED, limit: STORE_LIMIT })}
                </span>
              </div>
              <Progress
                value={Math.round((STORE_USED / STORE_LIMIT) * 100)}
                size="sm"
                tone="primary"
                aria-label={t('plan.storeFeature', { used: STORE_USED, limit: STORE_LIMIT })}
              />
            </div>

            {/* Auto-renewal toggle */}
            <SettingsRowGroup>
              <SettingsRow
                title={t('plan.autoRenewLabel')}
                description={t('plan.autoRenewDescription')}
                htmlFor="auto-renew-switch"
                icon={<DOMAIN_ICONS.autoRenew />}
                control={
                  <Switch
                    id="auto-renew-switch"
                    checked={autoRenew}
                    onCheckedChange={setAutoRenew}
                  />
                }
              />
            </SettingsRowGroup>
          </CardContent>

          <CardFooter className="gap-sm">
            <Button type="button" onClick={notifyDraft}>
              {t('plan.upgrade')}
            </Button>
            <Button type="button" variant="outline" onClick={notifyDraft}>
              {t('plan.cancelPlan')}
            </Button>
          </CardFooter>
        </Card>

        {/* RIGHT: Payment method card */}
        <Card className="lg:col-span-1">
          <SettingsCardHeader
            icon={<DOMAIN_ICONS.billingInfo />}
            title={t('payment.title')}
            description={t('payment.description')}
            status="draft"
          />

          <CardContent className="gap-md flex flex-col">
            {/* Saved card preview */}
            <div className="border-border bg-muted gap-sm p-md flex items-center rounded-lg border">
              <div className="gap-2xs flex min-w-0 flex-1 flex-col">
                <span className="text-foreground font-medium tabular-nums">
                  {t('payment.cardMask')}
                </span>
                <span className="text-muted-foreground text-xs">{t('payment.expiry')}</span>
              </div>
              <Badge tone="neutral" variant="outline">
                {t('payment.cardBrand')}
              </Badge>
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={notifyDraft}>
              {t('payment.update')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* -----------------------------------------------------------------------
          2. Fatura bilgileri card (unchanged, header upgraded)
          --------------------------------------------------------------------- */}

      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.billingInfo />}
          title={t('billing.title')}
          description={t('billing.description')}
          status="draft"
        />

        <Form {...billingForm}>
          <form method="post" noValidate onSubmit={billingForm.handleSubmit(notifyDraft)}>
            <CardContent className="gap-lg flex flex-col">
              {/* Invoice type radio */}
              <div className="gap-xs flex flex-col">
                <span className="text-foreground text-sm font-medium">
                  {t('billing.invoiceType')}
                </span>
                <RadioGroup
                  value={invoiceType}
                  onValueChange={(v) => setInvoiceType(v as InvoiceType)}
                  className="gap-sm flex flex-row"
                >
                  <div className="gap-xs flex items-center">
                    <RadioGroupItem value="individual" id="invoice-individual" />
                    <Label htmlFor="invoice-individual">{t('billing.individual')}</Label>
                  </div>
                  <div className="gap-xs flex items-center">
                    <RadioGroupItem value="corporate" id="invoice-corporate" />
                    <Label htmlFor="invoice-corporate">{t('billing.corporate')}</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Name / ID fields — conditional on invoice type */}
              <div className="gap-lg grid sm:grid-cols-2">
                {invoiceType === 'individual' ? (
                  <FormField
                    control={billingForm.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>{t('billing.fullName')}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="name"
                            placeholder={t('billing.fullNamePlaceholder')}
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={billingForm.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>{t('billing.companyName')}</FormLabel>
                        <FormControl>
                          <Input placeholder={t('billing.companyNamePlaceholder')} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}

                {invoiceType === 'individual' ? (
                  <FormField
                    control={billingForm.control}
                    name="tcKimlik"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('billing.tcKimlik')}</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            maxLength={11}
                            placeholder={t('billing.tcKimlikPlaceholder')}
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={billingForm.control}
                    name="vkn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('billing.vkn')}</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            maxLength={10}
                            placeholder={t('billing.vknPlaceholder')}
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={billingForm.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>{t('billing.address')}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t('billing.addressPlaceholder')}
                          resize="vertical"
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={billingForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('billing.city')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('billing.cityPlaceholder')} {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={billingForm.control}
                  name="district"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('billing.district')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('billing.districtPlaceholder')} {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={billingForm.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('billing.postalCode')}</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          maxLength={5}
                          placeholder={t('billing.postalCodePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>

            <CardFooter className="justify-end">
              <Button type="submit">{t('billing.save')}</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {/* -----------------------------------------------------------------------
          3. Fatura geçmişi card — invoice table with download actions
          --------------------------------------------------------------------- */}

      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.invoiceHistory />}
          title={t('history.title')}
          description={t('history.description')}
          status="draft"
        />

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('history.colDate')}</TableHead>
                <TableHead>{t('history.colNo')}</TableHead>
                <TableHead data-numeric="true">{t('history.colAmount')}</TableHead>
                <TableHead>{t('history.colStatus')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLACEHOLDER_INVOICES.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="text-muted-foreground text-sm">{invoice.date}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{invoice.id}</TableCell>
                  <TableCell
                    data-numeric="true"
                    className="text-foreground text-sm font-semibold tabular-nums"
                  >
                    ₺{invoice.amount}
                  </TableCell>
                  <TableCell>
                    <Badge tone="success" variant="surface">
                      {t('history.statusPaid')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('history.downloadAriaLabel')}
                      onClick={notifyDraft}
                    >
                      <Download04Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
