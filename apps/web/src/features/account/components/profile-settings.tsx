'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
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
import { DOMAIN_ICONS } from '@/lib/domain-icons';

import { initialsFrom } from '../lib/initials';

interface ProfileFormValues {
  fullName: string;
  phone: string;
}

export interface ProfileSettingsProps {
  email: string;
  fullName: string | null;
  timezone: string;
  language: string;
}

const TIMEZONE_OPTIONS = [{ value: 'Europe/Istanbul', label: 'İstanbul (GMT+3)' }] as const;
const LANGUAGE_OPTIONS = [
  { value: 'tr', label: 'Türkçe' },
  { value: 'en', label: 'English' },
] as const;

/**
 * Main column of the Profil page: the identity form (avatar + name + contact)
 * and the region/language block. The backend has no profile-update endpoint
 * yet, so both blocks are `draft` — they render the developer-only marker and
 * the save action surfaces a "coming soon" toast instead of persisting. Swap
 * the submit handlers for the real mutation once `PATCH /v1/me` lands.
 */
export function ProfileSettings({
  email,
  fullName,
  timezone,
  language,
}: ProfileSettingsProps): React.ReactElement {
  const t = useTranslations('settings.profile');
  const tStatus = useTranslations('featureStatus');

  const form = useForm<ProfileFormValues>({
    defaultValues: { fullName: fullName ?? '', phone: '' },
  });

  const knownTimezone = TIMEZONE_OPTIONS.some((o) => o.value === timezone)
    ? timezone
    : TIMEZONE_OPTIONS[0].value;
  const knownLanguage = LANGUAGE_OPTIONS.some((o) => o.value === language)
    ? language
    : LANGUAGE_OPTIONS[0].value;
  const [tz, setTz] = useState<string>(knownTimezone);
  const [lang, setLang] = useState<string>(knownLanguage);

  const watchedName = form.watch('fullName');
  const initials = initialsFrom(watchedName, email);

  function notifyDraft(): void {
    // No PATCH /v1/me yet — be honest rather than fake a success.
    toast.info(tStatus('draftActionToast'));
  }

  return (
    <>
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.profile />}
          title={t('identity.title')}
          description={t('identity.description')}
          status="draft"
        />

        <Form {...form}>
          <form method="post" noValidate onSubmit={form.handleSubmit(notifyDraft)}>
            <CardContent className="gap-lg flex flex-col">
              <div className="gap-md flex items-center">
                <Avatar size="lg">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="gap-2xs flex flex-col items-start">
                  <Button type="button" variant="outline" size="sm" onClick={notifyDraft}>
                    {t('avatar.change')}
                  </Button>
                  <p className="text-2xs text-muted-foreground">{t('avatar.hint')}</p>
                </div>
              </div>

              <div className="gap-lg grid sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.fullName')}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="name"
                          placeholder={t('fields.fullNamePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.phone')}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          autoComplete="tel"
                          placeholder={t('fields.phonePlaceholder')}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="gap-3xs flex flex-col sm:col-span-2">
                  <Label htmlFor="profile-email">{t('fields.email')}</Label>
                  <Input
                    id="profile-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    readOnly
                    disabled
                  />
                  <p className="text-2xs text-muted-foreground">{t('fields.emailHint')}</p>
                </div>
              </div>
            </CardContent>

            <CardFooter className="justify-end">
              <Button type="submit">{t('save')}</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.region />}
          title={t('region.title')}
          description={t('region.description')}
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
            <div className="gap-lg grid sm:grid-cols-2">
              <div className="gap-3xs flex flex-col">
                <span className="text-foreground text-sm font-medium">{t('region.timezone')}</span>
                <Select value={tz} onValueChange={setTz}>
                  <SelectTrigger aria-label={t('region.timezone')}>
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

              <div className="gap-3xs flex flex-col">
                <span className="text-foreground text-sm font-medium">{t('region.language')}</span>
                <Select value={lang} onValueChange={setLang}>
                  <SelectTrigger aria-label={t('region.language')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((o) => (
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
      </Card>
    </>
  );
}
