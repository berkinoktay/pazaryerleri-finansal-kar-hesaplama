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

import { useMyPreferences, useUpdateMyPreferences } from '../hooks/use-my-preferences';

/** Sample margin values shown in the always-on live preview strip. */
const PREVIEW_VALUES = [-30, -5, 8, 18, 40, 75] as const;

const MIN_BUCKETS = 2;
const MAX_BUCKETS = 8;

/** i18n key suffix for each preset, in display order. */
const PRESET_LABEL_KEY: Record<PresetKey, string> = {
  redGreen: 'presetRedGreen',
  colorblind: 'presetColorblind',
  purpleGreen: 'presetPurpleGreen',
  sunset: 'presetSunset',
  mono: 'presetMono',
};

/** Strictly-ascending + in-range validation; returns the first failure type. */
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

interface BucketRowLabels {
  pickColor: string;
  customColor: string;
  threshold: string;
  andBelow: string;
  andAbove: string;
  remove: string;
}

interface BucketRowProps {
  bucket: MarginBucket;
  index: number;
  total: number;
  onColorChange: (index: number, color: string) => void;
  onThresholdChange: (index: number, value: number) => void;
  onRemove: (index: number) => void;
  labels: BucketRowLabels;
}

function BucketRow({
  bucket,
  index,
  total,
  onColorChange,
  onThresholdChange,
  onRemove,
  labels,
}: BucketRowProps): React.ReactElement {
  const positionLabel =
    index === 0 ? labels.andBelow : index === total - 1 ? labels.andAbove : undefined;

  return (
    <div className="gap-sm flex items-center">
      <ColorSwatchPicker
        value={bucket.color}
        onChange={(color) => onColorChange(index, color)}
        label={labels.pickColor}
        customLabel={labels.customColor}
      />

      <Input
        type="number"
        size="sm"
        aria-label={labels.threshold}
        value={bucket.threshold}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed)) onThresholdChange(index, parsed);
        }}
        className="w-20 tabular-nums"
      />

      <span className="text-muted-foreground w-16 text-xs">{positionLabel}</span>

      <div className="flex-1" />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.remove}
        disabled={total <= MIN_BUCKETS}
        onClick={() => onRemove(index)}
        className="text-muted-foreground hover:text-destructive hover:bg-destructive-surface shrink-0 pointer-coarse:size-11"
      >
        <Delete02Icon className="size-icon-sm" aria-hidden />
      </Button>
    </div>
  );
}

// ── PreviewStrip ─────────────────────────────────────────────────────────────

function PreviewStrip({ buckets }: { buckets: MarginBucket[] }): React.ReactElement {
  return (
    <div className="gap-md flex flex-wrap">
      {PREVIEW_VALUES.map((v) => {
        // Preview ALWAYS shows the configured scale (enabled: true) so the user
        // sees their ranges even before flipping the master toggle on.
        const style = marginColorStyle(String(v), { enabled: true, buckets });
        return (
          <span key={v} className="text-sm font-semibold tabular-nums" style={style.style}>
            {v > 0 ? `+${v}%` : `${v}%`}
          </span>
        );
      })}
    </div>
  );
}

// ── MarginColoringSettings ───────────────────────────────────────────────────

/**
 * "Kâr Marjı Renklendirme" — a sibling card in the Tercihler page. Lets the user
 * enable a threshold-based color scale, edit each range's color (curated swatches
 * or a custom color) + lower threshold, apply a preset ramp, and preview live.
 * Local state seeds from useMyPreferences once it resolves (guarded setState, no
 * derived-state effect).
 */
export function MarginColoringSettings(): React.ReactElement {
  const t = useTranslations('settings.marginColoring');
  const { data: preferences } = useMyPreferences();
  const updateMutation = useUpdateMyPreferences();

  const [initialized, setInitialized] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [buckets, setBuckets] = React.useState<MarginBucket[]>(Array.from(DEFAULT_MARGIN_BUCKETS));
  const [error, setError] = React.useState<'ascending' | 'range' | null>(null);

  // One-time seed from the server once preferences arrive.
  if (!initialized && preferences !== undefined) {
    setInitialized(true);
    setEnabled(preferences.marginColoring?.enabled ?? false);
    setBuckets(Array.from(preferences.marginColoring?.buckets ?? DEFAULT_MARGIN_BUCKETS));
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

  const bucketLabels: BucketRowLabels = {
    pickColor: t('pickColor'),
    customColor: t('customColor'),
    threshold: t('thresholdLabel'),
    andBelow: t('andBelow'),
    andAbove: t('andAbove'),
    remove: t('removeBucket'),
  };

  function handleSave(): void {
    const err = validateBuckets(buckets);
    if (err !== null) {
      setError(err);
      return;
    }
    updateMutation.mutate(
      { marginColoring: { enabled, buckets } },
      { onSuccess: () => toast.success(t('savedToast')) },
    );
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
        <CardContent className="gap-lg pt-lg flex flex-col">
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
                <span className="text-muted-foreground text-2xs">{t('bucketsDescription')}</span>
              </div>
              <Select onValueChange={(v) => handlePreset(v as PresetKey)}>
                <SelectTrigger size="sm" className="w-44" aria-label={t('presetLabel')}>
                  <SelectValue placeholder={t('presetLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(PRESET_LABEL_KEY[key] as Parameters<typeof t>[0])}
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
                  onColorChange={(i, color) => patchBucket(i, { color })}
                  onThresholdChange={(i, threshold) => patchBucket(i, { threshold })}
                  onRemove={handleRemoveBucket}
                  labels={bucketLabels}
                />
              ))}
            </div>

            {error !== null ? (
              <p className="text-destructive text-xs" role="alert">
                {error === 'ascending' ? t('errorAscending') : t('errorRange')}
              </p>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={buckets.length >= MAX_BUCKETS}
              onClick={handleAddBucket}
              className="w-fit"
            >
              {t('addBucket')}
            </Button>
          </div>

          {/* Live preview */}
          <div className="gap-xs flex flex-col">
            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-sm font-medium">{t('previewTitle')}</span>
              <span className="text-muted-foreground text-2xs">{t('previewDescription')}</span>
            </div>
            <PreviewStrip buckets={buckets} />
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" disabled={updateMutation.isPending}>
            {t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
