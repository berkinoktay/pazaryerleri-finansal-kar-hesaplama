'use client';

import { Delete02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { ColorSwatchPicker } from '@/components/patterns/color-swatch-picker';
import { SettingsCardHeader } from '@/components/patterns/settings-section';
import { SettingsRow } from '@/components/patterns/settings-row';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import {
  applyPreset,
  DEFAULT_MARGIN_BUCKETS,
  PRESET_KEYS,
  type MarginBucket,
  type PresetKey,
} from '@/lib/margin-coloring';
import { marginColorStyle } from '@/lib/margin-color-style';
import { profitToneClass } from '@/lib/profit-tone';
import { cn } from '@/lib/utils';

import { useMyPreferences, useUpdateMyPreferences } from '../hooks/use-my-preferences';

/** Sample margin values shown in the live preview strip. */
const PREVIEW_VALUES = [-30, -5, 8, 18, 40, 75] as const;

const MIN_BUCKETS = 2;
const MAX_BUCKETS = 8;

const PRESET_LABEL_KEY = {
  redGreen: 'presetRedGreen',
  colorblind: 'presetColorblind',
  purpleGreen: 'presetPurpleGreen',
  sunset: 'presetSunset',
  mono: 'presetMono',
} as const satisfies Record<PresetKey, string>;

/**
 * Keep bucket[0] (the floor — no visible threshold) strictly below bucket[1],
 * which the backend's ascending-threshold check requires. bucket[0]'s threshold
 * is never shown or edited; only the boundaries on buckets[1..n-1] matter.
 */
function normalizeFloor(buckets: MarginBucket[]): MarginBucket[] {
  if (buckets.length < 2) return buckets;
  const floorCeil = buckets[1]!.threshold - 1;
  const floor = Math.max(-100, Math.min(buckets[0]!.threshold, floorCeil));
  return [{ ...buckets[0]!, threshold: floor }, ...buckets.slice(1)];
}

function validateBuckets(buckets: MarginBucket[]): 'ascending' | 'range' | null {
  for (const b of buckets) {
    if (b.threshold < -100 || b.threshold > 1000) return 'range';
  }
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i]!.threshold <= buckets[i - 1]!.threshold) return 'ascending';
  }
  return null;
}

// ── BucketRow ────────────────────────────────────────────────────────────────

interface BucketRowProps {
  bucket: MarginBucket;
  index: number;
  total: number;
  /** Resolved range label for this row (e.g. "%78 ve altı", "%10 eşiğine kadar", "ve üstü"). */
  rangeLabel: string;
  onColorChange: (index: number, color: string) => void;
  onThresholdChange: (index: number, value: number) => void;
  onRemove: (index: number) => void;
  pickColorLabel: string;
  customColorLabel: string;
  thresholdLabel: string;
  removeLabel: string;
}

function BucketRow({
  bucket,
  index,
  total,
  rangeLabel,
  onColorChange,
  onThresholdChange,
  onRemove,
  pickColorLabel,
  customColorLabel,
  thresholdLabel,
  removeLabel,
}: BucketRowProps): React.ReactElement {
  const isFloor = index === 0;

  return (
    <div className="gap-sm flex items-center">
      <ColorSwatchPicker
        value={bucket.color}
        onChange={(color) => onColorChange(index, color)}
        label={pickColorLabel}
        customLabel={customColorLabel}
      />

      {isFloor ? null : (
        <Input
          type="number"
          size="sm"
          aria-label={thresholdLabel}
          value={bucket.threshold}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) onThresholdChange(index, parsed);
          }}
          className="w-20 tabular-nums"
        />
      )}

      <span className="text-muted-foreground text-xs">{rangeLabel}</span>

      <div className="flex-1" />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={removeLabel}
        disabled={total <= MIN_BUCKETS}
        onClick={() => onRemove(index)}
        className="text-muted-foreground hover:text-destructive hover:bg-destructive-surface shrink-0 pointer-coarse:size-11"
      >
        <Delete02Icon className="size-icon-sm" aria-hidden />
      </Button>
    </div>
  );
}

// ── MarginColoringSettings ───────────────────────────────────────────────────

/**
 * "Kâr Marjı Renklendirme" settings card (a sibling in Tercihler). The user
 * toggles colored display on, edits a contiguous set of color ranges (the first
 * is the floor with no threshold; the rest carry a lower-bound threshold), can
 * apply a preset or reset to default, and sees a live preview that mirrors the
 * toggle. Local state seeds once from the server (guarded setState — no effect).
 */
export function MarginColoringSettings(): React.ReactElement {
  const t = useTranslations('settings.marginColoring');
  const tCommon = useTranslations('common');
  const preferencesQuery = useMyPreferences();
  const preferences = preferencesQuery.data;
  const updateMutation = useUpdateMyPreferences();

  const [initialized, setInitialized] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [buckets, setBuckets] = React.useState<MarginBucket[]>(Array.from(DEFAULT_MARGIN_BUCKETS));
  const [error, setError] = React.useState<'ascending' | 'range' | null>(null);

  if (!initialized && preferences !== undefined) {
    setInitialized(true);
    setEnabled(preferences.marginColoring?.enabled ?? false);
    setBuckets(Array.from(preferences.marginColoring?.buckets ?? DEFAULT_MARGIN_BUCKETS));
  }

  // GUARD (data-loss bug): while the stored preferences are still in flight the
  // card must NOT be editable — a save issued before the seed lands would PATCH
  // the defaults over the user's stored buckets. Render a skeleton mirror of
  // the card instead (all hooks above already ran, so the early return is safe).
  // Belt-and-braces: the submit button below also stays disabled until
  // `initialized`, which covers the query-error path (data never arrives).
  if (preferencesQuery.isPending) {
    return (
      <Card>
        <SettingsCardHeader
          icon={<DOMAIN_ICONS.theme />}
          title={t('title')}
          description={t('description')}
        />
        <CardContent
          role="status"
          aria-busy
          aria-label={tCommon('loading')}
          className="gap-lg flex flex-col"
        >
          {/* Enable-toggle row mirror */}
          <div className="gap-sm flex items-center justify-between">
            <div className="gap-2xs flex flex-col">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton radius="full" className="h-5 w-9" />
          </div>
          {/* Bucket rows mirror (swatch + threshold input + range label) */}
          <div className="gap-2xs flex flex-col">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="gap-sm flex items-center">
                <Skeleton radius="full" className="size-6" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Skeleton className="h-9 w-20" />
        </CardFooter>
      </Card>
    );
  }

  function patchBucket(index: number, patch: Partial<MarginBucket>): void {
    setBuckets((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
    setError(null);
  }

  function handleAddBucket(): void {
    setBuckets((prev) => {
      if (prev.length >= MAX_BUCKETS) return prev;
      const last = prev[prev.length - 1]!;
      return [...prev, { threshold: last.threshold + 10, color: last.color }];
    });
    setError(null);
  }

  function handleRemoveBucket(index: number): void {
    setBuckets((prev) => (prev.length <= MIN_BUCKETS ? prev : prev.filter((_, i) => i !== index)));
    setError(null);
  }

  function handlePreset(preset: PresetKey): void {
    setBuckets((prev) => applyPreset(prev, preset));
    setError(null);
  }

  function handleReset(): void {
    setBuckets(Array.from(DEFAULT_MARGIN_BUCKETS));
    setError(null);
  }

  function handleSave(): void {
    const normalized = normalizeFloor(buckets);
    const err = validateBuckets(normalized);
    if (err !== null) {
      setError(err);
      return;
    }
    updateMutation.mutate(
      { marginColoring: { enabled, buckets: normalized } },
      { onSuccess: () => toast.success(t('savedToast')) },
    );
  }

  /** Range label for a row: floor → "% next ve altı"; last → "ve üstü"; middle → "up to next". */
  function rangeLabelFor(index: number): string {
    const next = buckets[index + 1]?.threshold ?? 0;
    if (index === 0) return t('belowMax', { max: next });
    if (index === buckets.length - 1) return t('andAbove');
    return t('upToMax', { max: next });
  }

  return (
    <Card>
      <SettingsCardHeader
        icon={<DOMAIN_ICONS.theme />}
        title={t('title')}
        description={t('description')}
      />

      <form
        method="post"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <CardContent className="gap-lg flex flex-col">
          {/* Enable toggle */}
          <SettingsRow
            htmlFor="margin-coloring-enabled"
            icon={<DOMAIN_ICONS.theme />}
            title={t('enableLabel')}
            description={t('enableDescription')}
            control={
              <Switch
                id="margin-coloring-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label={t('enableLabel')}
              />
            }
          />

          {/* Ranges + inline preset */}
          <div className="gap-sm flex flex-col">
            <div className="gap-sm flex flex-wrap items-end justify-between">
              <div className="gap-3xs flex flex-col">
                <span className="text-foreground text-sm font-medium">{t('bucketsTitle')}</span>
                <span className="text-muted-foreground text-2xs max-w-prose-max">
                  {t('bucketsDescription')}
                </span>
              </div>
              <Select onValueChange={(v) => handlePreset(v as PresetKey)}>
                <SelectTrigger size="sm" className="w-44" aria-label={t('presetLabel')}>
                  <SelectValue placeholder={t('presetLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(PRESET_LABEL_KEY[key])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="gap-2xs flex flex-col">
              {buckets.map((bucket, index) => (
                <BucketRow
                  key={index}
                  bucket={bucket}
                  index={index}
                  total={buckets.length}
                  rangeLabel={rangeLabelFor(index)}
                  onColorChange={(i, color) => patchBucket(i, { color })}
                  onThresholdChange={(i, threshold) => patchBucket(i, { threshold })}
                  onRemove={handleRemoveBucket}
                  pickColorLabel={t('pickColor')}
                  customColorLabel={t('customColor')}
                  thresholdLabel={t('thresholdLabel')}
                  removeLabel={t('removeBucket')}
                />
              ))}
            </div>

            {error !== null ? (
              <p className="text-destructive text-xs" role="alert">
                {error === 'ascending' ? t('errorAscending') : t('errorRange')}
              </p>
            ) : null}

            <div className="gap-xs flex flex-wrap items-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={buckets.length >= MAX_BUCKETS}
                onClick={handleAddBucket}
              >
                {t('addBucket')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
                {t('resetDefault')}
              </Button>
            </div>
          </div>

          {/* Live preview — mirrors the toggle (binary when off, scale when on) */}
          <div className="gap-xs flex flex-col">
            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-sm font-medium">{t('previewTitle')}</span>
              <span className="text-muted-foreground text-2xs">{t('previewDescription')}</span>
            </div>
            <div className="gap-md flex flex-wrap">
              {PREVIEW_VALUES.map((v) => {
                const strV = String(v);
                // OFF: show the binary tone class (profitToneClass) so the preview
                //      reflects exactly what cells look like without margin coloring.
                // ON:  show the scale color via inline style (overrides the class).
                return (
                  <span
                    key={v}
                    className={cn(
                      'text-sm font-semibold tabular-nums',
                      enabled ? undefined : profitToneClass(strV),
                    )}
                    style={marginColorStyle(strV, { enabled, buckets })}
                  >
                    {v > 0 ? `+${v}%` : `${v}%`}
                  </span>
                );
              })}
            </div>
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          {/* !initialized covers the query-error path: without the stored
              preferences a save would overwrite them with the defaults. */}
          <Button type="submit" disabled={updateMutation.isPending || !initialized}>
            {t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
