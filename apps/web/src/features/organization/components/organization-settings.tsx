'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { useCurrentOrg } from '@/providers/current-scope';

interface OrgInfoFormValues {
  name: string;
  timezone: string;
  currency: string;
}

const TIMEZONE_OPTIONS = [{ value: 'Europe/Istanbul', label: 'İstanbul (GMT+3)' }] as const;

const CURRENCY_OPTIONS = [{ value: 'TRY', label: 'Türk Lirası (TRY)' }] as const;

/**
 * Main column of the Genel (organization) settings page.
 *
 * Two cards, both `draft` (no PATCH /v1/organizations/:id endpoint yet):
 *   1. Organizasyon bilgileri — logo, name, slug, timezone, currency.
 *   2. Muhasebe ayarları — two boolean preferences (negative VAT, stopaj).
 *
 * All save actions produce a "coming soon" toast until the backend lands.
 */
export function OrganizationSettings(): React.ReactElement {
  const t = useTranslations('settings.organization');
  const tStatus = useTranslations('featureStatus');
  const org = useCurrentOrg();

  const form = useForm<OrgInfoFormValues>({
    defaultValues: {
      name: org.name,
      timezone: TIMEZONE_OPTIONS[0].value,
      currency: CURRENCY_OPTIONS[0].value,
    },
  });

  const [tz, setTz] = useState<string>(TIMEZONE_OPTIONS[0].value);
  const [currency, setCurrency] = useState<string>(CURRENCY_OPTIONS[0].value);
  const [negativeVat, setNegativeVat] = useState(false);
  const [stopaj, setStopaj] = useState(false);

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  const orgInitials = org.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <>
      {/* Card 1: Organizasyon bilgileri */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.orgGeneral />}
          title={t('info.title')}
          description={t('info.description')}
          status="draft"
        />

        <Form {...form}>
          <form method="post" noValidate onSubmit={form.handleSubmit(notifyDraft)}>
            <CardContent className="gap-lg flex flex-col">
              {/* Logo row */}
              <div className="gap-md flex items-center">
                <Avatar size="lg">
                  <AvatarFallback>{orgInitials}</AvatarFallback>
                </Avatar>
                <div className="gap-2xs flex flex-col items-start">
                  <Button type="button" variant="outline" size="sm" onClick={notifyDraft}>
                    {t('logo.upload')}
                  </Button>
                  <p className="text-2xs text-muted-foreground">{t('logo.hint')}</p>
                </div>
              </div>

              <div className="gap-lg grid sm:grid-cols-2">
                {/* Organizasyon adı */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.name')}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="organization"
                          placeholder={t('fields.namePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Slug — read-only */}
                <div className="gap-3xs flex flex-col">
                  <Label htmlFor="org-slug">{t('fields.slug')}</Label>
                  <Input id="org-slug" value={org.slug} readOnly disabled />
                  <p className="text-2xs text-muted-foreground">{t('fields.slugHint')}</p>
                </div>

                {/* Saat dilimi */}
                <div className="gap-3xs flex flex-col">
                  <label htmlFor="org-timezone" className="text-foreground text-sm font-medium">
                    {t('fields.timezone')}
                  </label>
                  <Select value={tz} onValueChange={setTz}>
                    <SelectTrigger id="org-timezone" aria-label={t('fields.timezone')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Para birimi */}
                <div className="gap-3xs flex flex-col">
                  <label htmlFor="org-currency" className="text-foreground text-sm font-medium">
                    {t('fields.currency')}
                  </label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="org-currency" aria-label={t('fields.currency')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>

            <CardFooter className="justify-end">
              <Button type="submit">{t('save')}</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {/* Card 2: Muhasebe ayarları */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.accounting />}
          title={t('accounting.title')}
          description={t('accounting.description')}
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
            <SettingsRowGroup>
              <SettingsRow
                htmlFor="org-negative-vat"
                icon={<DOMAIN_ICONS.vat />}
                title={t('rows.negativeVat.title')}
                description={t('rows.negativeVat.description')}
                control={
                  <Switch
                    id="org-negative-vat"
                    checked={negativeVat}
                    onCheckedChange={setNegativeVat}
                  />
                }
              />
              <SettingsRow
                htmlFor="org-stopaj"
                icon={<DOMAIN_ICONS.withholding />}
                title={t('rows.stopaj.title')}
                description={t('rows.stopaj.description')}
                control={<Switch id="org-stopaj" checked={stopaj} onCheckedChange={setStopaj} />}
              />
            </SettingsRowGroup>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit">{t('save')}</Button>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}
