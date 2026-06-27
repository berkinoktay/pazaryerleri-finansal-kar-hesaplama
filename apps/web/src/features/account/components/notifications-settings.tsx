'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

interface EmailPrefs {
  allEmail: boolean;
  dailySummary: boolean;
  weeklyReport: boolean;
}

interface AlertPrefs {
  loss: boolean;
  margin: boolean;
  priceChange: boolean;
  returns: boolean;
  stock: boolean;
}

/**
 * Main column of the Bildirimler page: three cards covering e-posta
 * bildirimleri, uyari bildirimleri, and sistem bildirimleri. Each row carries a
 * domain icon chip (see `@/lib/domain-icons`). All blocks are draft — local
 * useState mirrors what the UI will eventually persist; the save action
 * surfaces the "coming soon" toast until the preference endpoints land.
 */
export function NotificationsSettings(): React.ReactElement {
  const t = useTranslations('settings.notifications');
  const tStatus = useTranslations('featureStatus');

  const [email, setEmail] = useState<EmailPrefs>({
    allEmail: true,
    dailySummary: true,
    weeklyReport: false,
  });

  const [alerts, setAlerts] = useState<AlertPrefs>({
    loss: true,
    margin: true,
    priceChange: false,
    returns: true,
    stock: false,
  });

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  function handleEmailSave(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    notifyDraft();
  }

  function handleAlertSave(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    notifyDraft();
  }

  function toggleEmail<K extends keyof EmailPrefs>(key: K): void {
    setEmail((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAlert<K extends keyof AlertPrefs>(key: K): void {
    setAlerts((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <>
      {/* ---- E-posta bildirimleri ---- */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.notifEmail />}
          title={t('email.title')}
          description={t('email.description')}
          status="draft"
        />

        <form method="post" noValidate onSubmit={handleEmailSave}>
          <CardContent>
            {/* Master toggle sits above the group, not inside it */}
            <SettingsRow
              htmlFor="notif-email-all"
              icon={<DOMAIN_ICONS.notifEmail />}
              title={t('email.masterLabel')}
              description={t('email.masterDescription')}
              control={
                <Switch
                  id="notif-email-all"
                  checked={email.allEmail}
                  onCheckedChange={() => toggleEmail('allEmail')}
                  aria-label={t('email.masterLabel')}
                />
              }
            />

            <SettingsRowGroup>
              <SettingsRow
                htmlFor="notif-email-daily"
                icon={<DOMAIN_ICONS.notifDailySummary />}
                title={t('email.dailySummaryLabel')}
                description={t('email.dailySummaryDescription')}
                control={
                  <Switch
                    id="notif-email-daily"
                    checked={email.dailySummary}
                    onCheckedChange={() => toggleEmail('dailySummary')}
                    disabled={!email.allEmail}
                    aria-label={t('email.dailySummaryLabel')}
                  />
                }
              />
              <SettingsRow
                htmlFor="notif-email-weekly"
                icon={<DOMAIN_ICONS.notifWeeklyReport />}
                title={t('email.weeklyReportLabel')}
                description={t('email.weeklyReportDescription')}
                control={
                  <Switch
                    id="notif-email-weekly"
                    checked={email.weeklyReport}
                    onCheckedChange={() => toggleEmail('weeklyReport')}
                    disabled={!email.allEmail}
                    aria-label={t('email.weeklyReportLabel')}
                  />
                }
              />
            </SettingsRowGroup>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit">{t('email.save')}</Button>
          </CardFooter>
        </form>
      </Card>

      {/* ---- Uyari bildirimleri ---- */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.notifSyncError />}
          title={t('alerts.title')}
          description={t('alerts.description')}
          status="draft"
        />

        <form method="post" noValidate onSubmit={handleAlertSave}>
          <CardContent>
            <SettingsRowGroup>
              <SettingsRow
                htmlFor="notif-alert-loss"
                icon={<DOMAIN_ICONS.notifLowMargin />}
                title={t('alerts.lossLabel')}
                description={t('alerts.lossDescription')}
                control={
                  <Switch
                    id="notif-alert-loss"
                    checked={alerts.loss}
                    onCheckedChange={() => toggleAlert('loss')}
                    aria-label={t('alerts.lossLabel')}
                  />
                }
              />
              <SettingsRow
                htmlFor="notif-alert-margin"
                icon={<DOMAIN_ICONS.notifLowMargin />}
                title={t('alerts.marginLabel')}
                description={t('alerts.marginDescription')}
                control={
                  <Switch
                    id="notif-alert-margin"
                    checked={alerts.margin}
                    onCheckedChange={() => toggleAlert('margin')}
                    aria-label={t('alerts.marginLabel')}
                  />
                }
              />
              <SettingsRow
                htmlFor="notif-alert-price"
                icon={<DOMAIN_ICONS.notifPrice />}
                title={t('alerts.priceChangeLabel')}
                description={t('alerts.priceChangeDescription')}
                control={
                  <Switch
                    id="notif-alert-price"
                    checked={alerts.priceChange}
                    onCheckedChange={() => toggleAlert('priceChange')}
                    aria-label={t('alerts.priceChangeLabel')}
                  />
                }
              />
              <SettingsRow
                htmlFor="notif-alert-return"
                icon={<DOMAIN_ICONS.notifReturn />}
                title={t('alerts.returnLabel')}
                description={t('alerts.returnDescription')}
                control={
                  <Switch
                    id="notif-alert-return"
                    checked={alerts.returns}
                    onCheckedChange={() => toggleAlert('returns')}
                    aria-label={t('alerts.returnLabel')}
                  />
                }
              />
              <SettingsRow
                htmlFor="notif-alert-stock"
                icon={<DOMAIN_ICONS.notifStock />}
                title={t('alerts.stockLabel')}
                description={t('alerts.stockDescription')}
                control={
                  <Switch
                    id="notif-alert-stock"
                    checked={alerts.stock}
                    onCheckedChange={() => toggleAlert('stock')}
                    aria-label={t('alerts.stockLabel')}
                  />
                }
              />
            </SettingsRowGroup>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit">{t('alerts.save')}</Button>
          </CardFooter>
        </form>
      </Card>

      {/* ---- Sistem bildirimleri ---- */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.notifSystem />}
          title={t('system.title')}
          description={t('system.description')}
        />
        <CardContent>
          <p className="text-muted-foreground text-sm leading-relaxed">{t('system.body')}</p>
        </CardContent>
      </Card>
    </>
  );
}
