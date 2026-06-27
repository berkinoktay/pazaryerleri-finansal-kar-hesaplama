'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
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
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { cn } from '@/lib/utils';

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
          <div className="gap-md grid sm:grid-cols-2">
            <TwoFactorMethodCard
              icon={<DOMAIN_ICONS.twoFactorSms />}
              title={t('twoFactor.sms.title')}
              description={t('twoFactor.sms.description')}
              comingSoonLabel={t('twoFactor.comingSoon')}
              configureLabel={t('twoFactor.configure')}
              onConfigure={notifyDraft}
            />
            <TwoFactorMethodCard
              icon={<DOMAIN_ICONS.twoFactorApp />}
              title={t('twoFactor.authenticator.title')}
              description={t('twoFactor.authenticator.description')}
              comingSoonLabel={t('twoFactor.comingSoon')}
              configureLabel={t('twoFactor.configure')}
              onConfigure={notifyDraft}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Oturumlar ──────────────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.sessions />}
          title={t('sessions.title')}
          description={t('sessions.description')}
          status="draft"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={notifyDraft}>
              {t('sessions.terminateOthers')}
            </Button>
          }
        />

        <CardContent>
          <SessionList notifyDraft={notifyDraft} />
        </CardContent>
      </Card>

      {/* ── 4. Tehlikeli bölge ────────────────────────────────────────────── */}
      <Card className="border-destructive bg-destructive-surface">
        <CardContent className="p-lg gap-md flex flex-col items-start justify-between sm:flex-row sm:items-center">
          <div className="gap-sm flex items-start">
            <SoftSquareIcon variant="soft" tone="destructive" size="sm" className="mt-3xs shrink-0">
              <DOMAIN_ICONS.deleteAccount />
            </SoftSquareIcon>
            <div className="gap-3xs flex flex-col">
              <span className="text-md text-destructive leading-tight font-semibold tracking-tight">
                {t('dangerZone.deleteAccount.title')}
              </span>
              <span className="text-muted-foreground text-sm">
                {t('dangerZone.deleteAccount.headerDescription')}
              </span>
            </div>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" size="sm" className="shrink-0">
                {t('dangerZone.deleteAccount.button')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('dangerZone.deleteAccount.dialog.title')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('dangerZone.deleteAccount.dialog.description')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('dangerZone.deleteAccount.dialog.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={notifyDraft}>
                  {t('dangerZone.deleteAccount.dialog.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Two-Factor Method Sub-Card ────────────────────────────────────────────

interface TwoFactorMethodCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  comingSoonLabel: string;
  configureLabel: string;
  onConfigure: () => void;
}

function TwoFactorMethodCard({
  icon,
  title,
  description,
  comingSoonLabel,
  configureLabel,
  onConfigure,
}: TwoFactorMethodCardProps): React.ReactElement {
  return (
    <div className="border-border p-md gap-sm flex flex-col rounded-lg border">
      <div className="gap-sm flex items-start justify-between">
        <SoftSquareIcon variant="soft" tone="neutral">
          {icon}
        </SoftSquareIcon>
        <Badge tone="neutral" variant="surface" size="sm">
          {comingSoonLabel}
        </Badge>
      </div>
      <div className="gap-3xs flex flex-col">
        <span className="text-foreground text-sm font-medium">{title}</span>
        <span className="text-2xs text-muted-foreground leading-relaxed">{description}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-auto w-full"
        onClick={onConfigure}
      >
        {configureLabel}
      </Button>
    </div>
  );
}

// ─── Session List ──────────────────────────────────────────────────────────

interface SessionListProps {
  notifyDraft: () => void;
}

function SessionList({ notifyDraft }: SessionListProps): React.ReactElement {
  const t = useTranslations('settings.security');

  return (
    <div className="divide-border-muted divide-y">
      <SessionRow
        device={t('sessions.rows.macbook.device')}
        browser={t('sessions.rows.macbook.browser')}
        os={t('sessions.rows.macbook.os')}
        location={t('sessions.rows.macbook.location')}
        isCurrentDevice
        thisDeviceLabel={t('sessions.thisDevice')}
        activeNowLabel={t('sessions.activeNow')}
        terminateLabel={t('sessions.terminate')}
        onTerminate={undefined}
      />
      <SessionRow
        device={t('sessions.rows.iphone.device')}
        browser={t('sessions.rows.iphone.browser')}
        os={t('sessions.rows.iphone.os')}
        location={t('sessions.rows.iphone.location')}
        lastSeen={t('sessions.rows.iphone.lastSeen')}
        terminateLabel={t('sessions.terminate')}
        onTerminate={notifyDraft}
      />
      <SessionRow
        device={t('sessions.rows.thinkpad.device')}
        browser={t('sessions.rows.thinkpad.browser')}
        os={t('sessions.rows.thinkpad.os')}
        location={t('sessions.rows.thinkpad.location')}
        lastSeen={t('sessions.rows.thinkpad.lastSeen')}
        terminateLabel={t('sessions.terminate')}
        onTerminate={notifyDraft}
      />
    </div>
  );
}

// ─── Session Row ───────────────────────────────────────────────────────────

interface SessionRowProps {
  device: string;
  browser: string;
  os: string;
  location: string;
  isCurrentDevice?: boolean;
  lastSeen?: string;
  thisDeviceLabel?: string;
  activeNowLabel?: string;
  terminateLabel: string;
  onTerminate: (() => void) | undefined;
}

function SessionRow({
  device,
  browser,
  os,
  location,
  isCurrentDevice = false,
  lastSeen,
  thisDeviceLabel,
  activeNowLabel,
  terminateLabel,
  onTerminate,
}: SessionRowProps): React.ReactElement {
  return (
    <div className="py-md gap-md flex flex-col sm:flex-row sm:items-center sm:justify-between">
      {/* Device + browser info */}
      <div className="gap-sm flex min-w-0 items-center">
        <SoftSquareIcon variant="soft" tone="neutral" shape="circle" size="sm">
          <DOMAIN_ICONS.sessions />
        </SoftSquareIcon>
        <div className="gap-3xs flex min-w-0 flex-col">
          <div className="gap-xs flex flex-wrap items-center">
            <span className="text-foreground text-sm font-medium">{device}</span>
            {isCurrentDevice && thisDeviceLabel !== undefined ? (
              <Badge tone="neutral" variant="surface" size="sm">
                {thisDeviceLabel}
              </Badge>
            ) : null}
          </div>
          <span className="text-2xs text-muted-foreground">
            {browser} · {os}
          </span>
        </div>
      </div>

      {/* Location + last-seen + action */}
      <div className="gap-md flex items-center sm:shrink-0">
        <div className="gap-3xs flex flex-col items-end">
          <span className="text-foreground text-xs">{location}</span>
          {isCurrentDevice && activeNowLabel !== undefined ? (
            <Badge tone="success" variant="surface" size="sm">
              {activeNowLabel}
            </Badge>
          ) : (
            <span className="text-2xs text-muted-foreground tabular-nums">{lastSeen}</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={onTerminate === undefined}
          onClick={onTerminate}
          className={cn(
            'shrink-0',
            onTerminate !== undefined &&
              'text-destructive hover:text-destructive hover:bg-destructive-surface',
          )}
        >
          {terminateLabel}
        </Button>
      </div>
    </div>
  );
}
