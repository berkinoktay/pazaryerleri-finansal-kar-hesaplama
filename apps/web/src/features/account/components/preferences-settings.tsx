'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow, SettingsRowGroup } from '@/components/patterns/settings-row';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { useIsMounted } from '@/lib/use-is-mounted';
import { useTheme } from '@/providers/theme-provider';

type ThemeValue = 'light' | 'dark' | 'system';

const CURRENCY_OPTIONS = [
  { value: 'TRY', labelKey: 'currencyTRY' },
  { value: 'USD', labelKey: 'currencyUSD' },
] as const;

const NUMBER_OPTIONS = [
  { value: 'dot-comma', labelKey: 'numberDotComma' },
  { value: 'comma-point', labelKey: 'numberCommaPoint' },
] as const;

const DATE_OPTIONS = [
  { value: 'dmy', labelKey: 'dateDMY' },
  { value: 'ymd', labelKey: 'dateYMD' },
] as const;

/**
 * Main column of the Tercihler page.
 *
 * "Görünüm" — the one live block: a ToggleGroup wired to next-themes'
 * setTheme. SSR-safe: the selected item is only computed after mount
 * (useIsMounted gate) so the server and first client render are
 * byte-identical on "system".
 *
 * "Biçimler" — draft block: currency / number / date selects. Save
 * action fires a "coming soon" toast instead of persisting.
 *
 * "Klavye kısayolları" — draft placeholder with a "Yakında" badge.
 */
export function PreferencesSettings(): React.ReactElement {
  const t = useTranslations('settings.preferences');
  const tStatus = useTranslations('featureStatus');
  const mounted = useIsMounted();
  const { setTheme, theme } = useTheme();

  // Derive the active theme value for the ToggleGroup only after mount so
  // SSR renders a neutral "system" default and hydration stays byte-identical.
  const activeTheme: ThemeValue = mounted
    ? ((theme as ThemeValue | undefined) ?? 'system')
    : 'system';

  // Draft formats state — not persisted yet.
  const [currency, setCurrency] = useState<string>('TRY');
  const [numberFmt, setNumberFmt] = useState<string>('dot-comma');
  const [dateFmt, setDateFmt] = useState<string>('dmy');

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  return (
    <>
      {/* ── Görünüm (live) ─────────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.theme />}
          title={t('appearance.title')}
          description={t('appearance.description')}
        />

        <CardContent>
          <SettingsRow
            htmlFor="theme-toggle"
            icon={<DOMAIN_ICONS.theme />}
            title={t('appearance.themeLabel')}
            description={t('appearance.themeDescription')}
            control={
              <ToggleGroup
                id="theme-toggle"
                type="single"
                aria-label={t('appearance.themeLabel')}
                value={activeTheme}
                onValueChange={(value) => {
                  if (value !== '') setTheme(value);
                }}
              >
                <ToggleGroupItem value="light" aria-label={t('appearance.themeLight')}>
                  {t('appearance.themeLight')}
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label={t('appearance.themeDark')}>
                  {t('appearance.themeDark')}
                </ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label={t('appearance.themeSystem')}>
                  {t('appearance.themeSystem')}
                </ToggleGroupItem>
              </ToggleGroup>
            }
          />
        </CardContent>
      </Card>

      {/* ── Biçimler (draft) ───────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.currency />}
          title={t('formats.title')}
          description={t('formats.description')}
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
                htmlFor="pref-currency"
                icon={<DOMAIN_ICONS.currency />}
                title={t('formats.currencyLabel')}
                description={t('formats.currencyDescription')}
                control={
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger
                      id="pref-currency"
                      aria-label={t('formats.currencyLabel')}
                      className="w-56"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {t(`formats.${o.labelKey}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />

              <SettingsRow
                htmlFor="pref-number"
                icon={<DOMAIN_ICONS.numberFormat />}
                title={t('formats.numberLabel')}
                description={t('formats.numberDescription')}
                control={
                  <Select value={numberFmt} onValueChange={setNumberFmt}>
                    <SelectTrigger
                      id="pref-number"
                      aria-label={t('formats.numberLabel')}
                      className="w-56"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NUMBER_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {t(`formats.${o.labelKey}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />

              <SettingsRow
                htmlFor="pref-date"
                icon={<DOMAIN_ICONS.dateFormat />}
                title={t('formats.dateLabel')}
                description={t('formats.dateDescription')}
                control={
                  <Select value={dateFmt} onValueChange={setDateFmt}>
                    <SelectTrigger
                      id="pref-date"
                      aria-label={t('formats.dateLabel')}
                      className="w-56"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {t(`formats.${o.labelKey}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </SettingsRowGroup>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit">{t('formats.save')}</Button>
          </CardFooter>
        </form>
      </Card>

      {/* ── Klavye kısayolları (draft placeholder) ─────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.shortcuts />}
          title={t('shortcuts.title')}
          description={t('shortcuts.description')}
          status="draft"
        />

        <CardContent>
          <div className="gap-md flex flex-col">
            <p className="text-muted-foreground text-sm">{t('shortcuts.note')}</p>
            <div>
              <Badge tone="neutral" variant="outline">
                {t('shortcuts.comingSoon')}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
