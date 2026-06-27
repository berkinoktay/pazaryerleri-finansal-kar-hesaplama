'use client';

import { CheckmarkCircle02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow } from '@/components/patterns/settings-row';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { cn } from '@/lib/utils';
import { useIsMounted } from '@/lib/use-is-mounted';
import { useTheme } from '@/providers/theme-provider';

type ThemeValue = 'light' | 'dark' | 'system';

interface ThemeOption {
  value: ThemeValue;
  labelKey: 'themeCardLight' | 'themeCardDark' | 'themeCardSystem';
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', labelKey: 'themeCardLight' },
  { value: 'dark', labelKey: 'themeCardDark' },
  { value: 'system', labelKey: 'themeCardSystem' },
] as const;

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

interface ShortcutRow {
  labelKey: 'shortcutCommandMenu' | 'shortcutGoToSettings' | 'shortcutQuickSearch';
  keys: React.ReactNode;
}

// ──────────────────────────────────────────────────────────────
// Theme preview mini-cards
// ──────────────────────────────────────────────────────────────

function ThemePreviewLight(): React.ReactElement {
  return (
    <div className="bg-muted h-full w-full overflow-hidden rounded-md">
      <div className="p-xs h-full w-full">
        <div className="bg-card border-border h-full w-full rounded-sm border" />
      </div>
    </div>
  );
}

function ThemePreviewDark(): React.ReactElement {
  return (
    <div className="bg-foreground h-full w-full overflow-hidden rounded-md">
      <div className="p-xs h-full w-full">
        <div className="bg-muted-foreground h-full w-full rounded-sm" />
      </div>
    </div>
  );
}

function ThemePreviewSystem(): React.ReactElement {
  return (
    <div className="h-full w-full overflow-hidden rounded-md">
      <div className="flex h-full w-full">
        {/* Left half — light */}
        <div className="bg-muted flex-1 overflow-hidden">
          <div className="p-xs h-full w-full">
            <div className="bg-card border-border h-full w-full rounded-sm border" />
          </div>
        </div>
        {/* Right half — dark */}
        <div className="bg-foreground flex-1 overflow-hidden">
          <div className="p-xs h-full w-full">
            <div className="bg-muted-foreground h-full w-full rounded-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

const THEME_PREVIEW: Record<ThemeValue, React.ReactElement> = {
  light: <ThemePreviewLight />,
  dark: <ThemePreviewDark />,
  system: <ThemePreviewSystem />,
};

// ──────────────────────────────────────────────────────────────
// ThemeCard
// ──────────────────────────────────────────────────────────────

interface ThemeCardProps {
  value: ThemeValue;
  label: string;
  selectedLabel: string;
  isSelected: boolean;
  onSelect: (value: ThemeValue) => void;
}

function ThemeCard({
  value,
  label,
  selectedLabel,
  isSelected,
  onSelect,
}: ThemeCardProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={`${label}${isSelected ? ` — ${selectedLabel}` : ''}`}
      aria-pressed={isSelected}
      onClick={() => onSelect(value)}
      className={cn(
        'gap-sm duration-fast ease-out-quart focus-visible:ring-ring focus-visible:ring-offset-background p-xs relative flex flex-col rounded-lg border text-left transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        isSelected
          ? 'border-primary bg-primary-soft shadow-xs'
          : 'border-border bg-card hover:border-border-strong hover:shadow-xs',
      )}
    >
      {/* Mini preview */}
      <div className="h-14 w-full overflow-hidden rounded-md">{THEME_PREVIEW[value]}</div>

      {/* Label row */}
      <div className="gap-xs flex items-center justify-between">
        <span
          className={cn(
            'text-xs font-medium',
            isSelected ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
        {isSelected ? (
          <CheckmarkCircle02Icon className="text-primary size-icon-xs shrink-0" aria-hidden />
        ) : null}
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────

/**
 * Main column of the Tercihler page.
 *
 * "Gorünum" — live block: three visual theme cards wired to next-themes'
 * setTheme. SSR-safe: selected state is only computed after mount
 * (useIsMounted gate) so server and first client render are byte-identical.
 *
 * "Bicimler" — draft block: currency / number / date selects in a row.
 * Save action fires the "coming soon" toast.
 *
 * "Klavye kisayollari" — draft block: enable switch + shortcut list.
 */
export function PreferencesSettings(): React.ReactElement {
  const t = useTranslations('settings.preferences');
  const tStatus = useTranslations('featureStatus');
  const mounted = useIsMounted();
  const { setTheme, theme } = useTheme();

  // Derive the active theme value only after mount so SSR renders none-selected
  // and hydration stays byte-identical.
  const activeTheme: ThemeValue | null = mounted
    ? ((theme as ThemeValue | undefined) ?? 'system')
    : null;

  // Draft formats state — not persisted yet.
  const [currency, setCurrency] = useState<string>('TRY');
  const [numberFmt, setNumberFmt] = useState<string>('dot-comma');
  const [dateFmt, setDateFmt] = useState<string>('dmy');

  // Draft shortcuts state — not persisted yet.
  const [shortcutsEnabled, setShortcutsEnabled] = useState<boolean>(true);

  function notifyDraft(): void {
    toast.info(tStatus('draftActionToast'));
  }

  const SHORTCUTS: readonly ShortcutRow[] = [
    {
      labelKey: 'shortcutCommandMenu',
      keys: (
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      ),
    },
    {
      labelKey: 'shortcutGoToSettings',
      keys: (
        <KbdGroup>
          <Kbd>G</Kbd>
          <Kbd>S</Kbd>
        </KbdGroup>
      ),
    },
    {
      labelKey: 'shortcutQuickSearch',
      keys: <Kbd>/</Kbd>,
    },
  ] as const;

  return (
    <>
      {/* ── Görünüm (live) ─────────────────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.theme />}
          title={t('appearance.title')}
          description={t('appearance.description')}
          actions={
            <span className="text-muted-foreground text-xs tabular-nums">
              {t('appearance.instantHint')}
            </span>
          }
        />

        <CardContent>
          <div className="gap-md grid grid-cols-3">
            {THEME_OPTIONS.map((option) => (
              <ThemeCard
                key={option.value}
                value={option.value}
                label={t(`appearance.${option.labelKey}`)}
                selectedLabel={t('appearance.themeCardSelectedLabel')}
                isSelected={activeTheme === option.value}
                onSelect={(v) => setTheme(v)}
              />
            ))}
          </div>
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
            <div className="gap-lg grid sm:grid-cols-3">
              {/* Para birimi */}
              <div className="gap-3xs flex flex-col">
                <label htmlFor="pref-currency" className="text-foreground text-sm font-medium">
                  {t('formats.currencyLabel')}
                </label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="pref-currency" aria-label={t('formats.currencyLabel')}>
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
              </div>

              {/* Sayi bicimi */}
              <div className="gap-3xs flex flex-col">
                <label htmlFor="pref-number" className="text-foreground text-sm font-medium">
                  {t('formats.numberLabel')}
                </label>
                <Select value={numberFmt} onValueChange={setNumberFmt}>
                  <SelectTrigger id="pref-number" aria-label={t('formats.numberLabel')}>
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
              </div>

              {/* Tarih bicimi */}
              <div className="gap-3xs flex flex-col">
                <label htmlFor="pref-date" className="text-foreground text-sm font-medium">
                  {t('formats.dateLabel')}
                </label>
                <Select value={dateFmt} onValueChange={setDateFmt}>
                  <SelectTrigger id="pref-date" aria-label={t('formats.dateLabel')}>
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
              </div>
            </div>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit">{t('formats.save')}</Button>
          </CardFooter>
        </form>
      </Card>

      {/* ── Klavye kısayolları (draft) ──────────────────────────────────── */}
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.shortcuts />}
          title={t('shortcuts.title')}
          description={t('shortcuts.description')}
          status="draft"
        />

        <CardContent>
          {/* Master enable row */}
          <SettingsRow
            htmlFor="shortcuts-enabled"
            icon={<DOMAIN_ICONS.shortcuts />}
            title={t('shortcuts.enableLabel')}
            description={t('shortcuts.enableDescription')}
            control={
              <Switch
                id="shortcuts-enabled"
                checked={shortcutsEnabled}
                onCheckedChange={(checked) => setShortcutsEnabled(checked)}
                aria-label={t('shortcuts.enableLabel')}
              />
            }
          />

          <Separator variant="muted" className="my-md" />

          {/* Shortcut list */}
          <div className="gap-xs flex flex-col">
            {SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.labelKey}
                className="gap-sm py-xs flex items-center justify-between"
              >
                <span className="text-muted-foreground text-sm">
                  {t(`shortcuts.${shortcut.labelKey}`)}
                </span>
                <div className="shrink-0">{shortcut.keys}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
