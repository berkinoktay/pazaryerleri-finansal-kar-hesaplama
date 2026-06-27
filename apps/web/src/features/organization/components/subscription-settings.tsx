'use client';

import { Invoice01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import { EmptyState } from '@/components/patterns/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
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

/** ISO date string used as representative period end. Hard-coded to avoid Date.now() on server. */
const PLACEHOLDER_PERIOD_END = new Date('2026-07-15T00:00:00Z');
const PLACEHOLDER_PERIOD_START = new Date('2026-06-15T00:00:00Z');

function periodProgressPercent(): number {
  const total = PLACEHOLDER_PERIOD_END.getTime() - PLACEHOLDER_PERIOD_START.getTime();
  // Fixed placeholder: 60% of the billing period elapsed. A real value will come
  // from the API once the billing backend ships. Using a constant fraction (not
  // `Date.now()`) keeps this SSR-safe.
  const elapsed = total * 0.6;
  return Math.min(Math.round((elapsed / total) * 100), 100);
}

/** Formats a Date as "15 Temmuz 2026" without Intl to avoid SSR locale drift. */
function formatDateTR(date: Date): string {
  const months = [
    'Ocak',
    'Şubat',
    'Mart',
    'Nisan',
    'Mayıs',
    'Haziran',
    'Temmuz',
    'Ağustos',
    'Eylül',
    'Ekim',
    'Kasım',
    'Aralık',
  ];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Main column of the Abonelik page. Composes three cards:
 * 1. Mevcut plan — plan details, auto-renewal toggle, period progress.
 * 2. Fatura bilgileri — billing type radio + form fields.
 * 3. Fatura geçmişi — empty state (no backend yet).
 *
 * All blocks are `draft` — save actions show a "coming soon" toast instead of
 * persisting. Swap handlers for real mutations once the billing API lands.
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

  const periodEnd = formatDateTR(PLACEHOLDER_PERIOD_END);
  const periodPercent = periodProgressPercent();

  // ---------------------------------------------------------------------------
  // 1. Mevcut plan card
  // ---------------------------------------------------------------------------

  return (
    <>
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.plan />}
          title={t('plan.title')}
          description={t('plan.description')}
          status="draft"
        />

        <CardContent className="gap-lg flex flex-col">
          {/* Plan name chip */}
          <div className="gap-xs flex items-center">
            <span className="text-foreground text-base font-semibold">{t('plan.planName')}</span>
            <Badge tone="primary" variant="surface">
              {t('plan.planName')}
            </Badge>
          </div>

          {/* Static info rows */}
          <dl className="flex flex-col gap-0">
            <div className="border-border-muted py-sm flex items-center justify-between border-b text-sm">
              <dt className="text-muted-foreground">{t('plan.storeLimit')}</dt>
              <dd className="text-foreground font-medium tabular-nums">3</dd>
            </div>
            <div className="border-border-muted py-sm flex items-center justify-between border-b text-sm">
              <dt className="text-muted-foreground">{t('plan.periodEnd')}</dt>
              <dd className="text-foreground font-medium">{periodEnd}</dd>
            </div>
          </dl>

          {/* Auto-renewal toggle */}
          <SettingsRowGroup>
            <SettingsRow
              title={t('plan.autoRenewLabel')}
              description={t('plan.autoRenewDescription')}
              htmlFor="auto-renew-switch"
              icon={<DOMAIN_ICONS.autoRenew />}
              control={
                <Switch id="auto-renew-switch" checked={autoRenew} onCheckedChange={setAutoRenew} />
              }
            />
          </SettingsRowGroup>

          {/* Period progress bar */}
          <div className="gap-xs flex flex-col">
            <span className="text-muted-foreground text-xs">{t('plan.periodProgress')}</span>
            <Progress value={periodPercent} size="sm" aria-label={t('plan.periodProgress')} />
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="button" onClick={notifyDraft}>
            {t('plan.changePlan')}
          </Button>
        </CardFooter>
      </Card>

      {/* -----------------------------------------------------------------------
          2. Fatura bilgileri card
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
          3. Fatura geçmişi card
          --------------------------------------------------------------------- */}

      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.invoiceHistory />}
          title={t('history.title')}
          description={t('history.description')}
          status="draft"
        />

        <CardContent>
          <EmptyState
            embedded
            icon={Invoice01Icon}
            title={t('history.emptyTitle')}
            description={t('history.emptyDescription')}
          />
        </CardContent>
      </Card>
    </>
  );
}
