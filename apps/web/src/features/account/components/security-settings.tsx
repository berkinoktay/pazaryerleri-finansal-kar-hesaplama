'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

interface PasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Main column of the Güvenlik page. All four sections are draft — the backend
 * has no password-change, 2FA, session-revoke, or account-delete endpoint yet.
 * Every save/primary action fires a draft toast rather than persisting.
 * Swap the submit handlers for real mutations once the backend lands.
 */
export function SecuritySettings(): React.ReactElement {
  const t = useTranslations('settings.security');
  const tStatus = useTranslations('featureStatus');

  const form = useForm<PasswordFormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  return (
    <>
      {/* ── 1. Şifre değiştir ─────────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.password />}
          title={t('password.title')}
          description={t('password.description')}
          status="draft"
        />

        <Form {...form}>
          <form method="post" noValidate onSubmit={form.handleSubmit(notifyDraft)}>
            <CardContent className="gap-lg flex flex-col">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('password.currentPassword')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder={t('password.currentPasswordPlaceholder')}
                        reveal={{
                          show: t('password.reveal.show'),
                          hide: t('password.reveal.hide'),
                        }}
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="gap-lg grid sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('password.newPassword')}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('password.newPasswordPlaceholder')}
                          reveal={{
                            show: t('password.reveal.show'),
                            hide: t('password.reveal.hide'),
                          }}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('password.confirmPassword')}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('password.confirmPasswordPlaceholder')}
                          reveal={{
                            show: t('password.reveal.show'),
                            hide: t('password.reveal.hide'),
                          }}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>

            <CardFooter className="justify-end">
              <Button type="submit">{t('save')}</Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {/* ── 2. İki faktörlü doğrulama ─────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.twoFactor />}
          title={t('twoFactor.title')}
          description={t('twoFactor.description')}
          status="draft"
        />

        <CardContent>
          <SettingsRowGroup>
            <SettingsRow
              icon={<DOMAIN_ICONS.twoFactorSms />}
              title={t('twoFactor.sms.title')}
              description={t('twoFactor.sms.description')}
              control={
                <div className="gap-sm flex items-center">
                  <Badge tone="neutral" size="sm">
                    {t('twoFactor.comingSoon')}
                  </Badge>
                  <Switch disabled checked={false} aria-label={t('twoFactor.sms.title')} />
                </div>
              }
            />
            <SettingsRow
              icon={<DOMAIN_ICONS.twoFactorApp />}
              title={t('twoFactor.authenticator.title')}
              description={t('twoFactor.authenticator.description')}
              control={
                <div className="gap-sm flex items-center">
                  <Badge tone="neutral" size="sm">
                    {t('twoFactor.comingSoon')}
                  </Badge>
                  <Switch
                    disabled
                    checked={false}
                    aria-label={t('twoFactor.authenticator.title')}
                  />
                </div>
              }
            />
          </SettingsRowGroup>
        </CardContent>
      </Card>

      {/* ── 3. Oturumlar ──────────────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.sessions />}
          title={t('sessions.title')}
          description={t('sessions.description')}
          status="draft"
        />

        <CardContent>
          <SettingsRowGroup>
            <SettingsRow
              icon={<DOMAIN_ICONS.sessions />}
              title={t('sessions.activeSession.title')}
              description={t('sessions.activeSession.description')}
              control={
                <Button type="button" variant="ghost" size="sm" onClick={notifyDraft}>
                  {t('sessions.signOut')}
                </Button>
              }
            />
          </SettingsRowGroup>
        </CardContent>
      </Card>

      {/* ── 4. Tehlikeli bölge ────────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.dangerZone />}
          iconTone="destructive"
          title={t('dangerZone.title')}
          description={t('dangerZone.description')}
          status="draft"
        />

        <CardContent>
          <SettingsRowGroup>
            <SettingsRow
              icon={<DOMAIN_ICONS.deleteAccount />}
              iconTone="destructive"
              title={t('dangerZone.deleteAccount.title')}
              description={t('dangerZone.deleteAccount.description')}
              control={
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" size="sm">
                      {t('dangerZone.deleteAccount.button')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t('dangerZone.deleteAccount.dialog.title')}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('dangerZone.deleteAccount.dialog.description')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t('dangerZone.deleteAccount.dialog.cancel')}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={notifyDraft}>
                        {t('dangerZone.deleteAccount.dialog.confirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              }
            />
          </SettingsRowGroup>
        </CardContent>
      </Card>
    </>
  );
}
