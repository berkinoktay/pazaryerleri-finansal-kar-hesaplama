'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
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
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { DEFAULT_MARGIN_BUCKETS, PRESET_SCALES, type MarginBucket } from '@/lib/margin-coloring';
import { marginColorStyle } from '@/lib/margin-color-style';
import { cn } from '@/lib/utils';

import { useMyPreferences, useUpdateMyPreferences } from '../hooks/use-my-preferences';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sample margin values shown in the live preview strip. */
const PREVIEW_VALUES = [-30, -5, 8, 18, 40, 75] as const;

/** Preset key type aligned with PRESET_SCALES. */
type PresetKey = 'redGreen' | 'colorblind';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate that thresholds are strictly ascending and within range. */
function validateBuckets(buckets: MarginBucket[]): { type: 'ascending' | 'range' } | null {
  for (const b of buckets) {
    if (b.threshold < -100 || b.threshold > 1000) return { type: 'range' };
  }
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i]!.threshold <= buckets[i - 1]!.threshold) {
      return { type: 'ascending' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// BucketRow
// ---------------------------------------------------------------------------

interface BucketRowProps {
  bucket: MarginBucket;
  index: number;
  total: number;
  onColorChange: (index: number, color: string) => void;
  onThresholdChange: (index: number, value: number) => void;
  onRemove: (index: number) => void;
  pickColorLabel: string;
  thresholdLabel: string;
  andBelowLabel: string;
  andAboveLabel: string;
  removeLabel: string;
}

function BucketRow({
  bucket,
  index,
  total,
  onColorChange,
  onThresholdChange,
  onRemove,
  pickColorLabel,
  thresholdLabel,
  andBelowLabel,
  andAboveLabel,
  removeLabel,
}: BucketRowProps): React.ReactElement {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const positionLabel = isFirst ? andBelowLabel : isLast ? andAboveLabel : undefined;

  return (
    <div className="gap-sm flex flex-wrap items-center">
      {/* Color picker */}
      <ColorSwatchPicker
        value={bucket.color}
        onChange={(color) => onColorChange(index, color)}
        label={pickColorLabel}
      />

      {/* Threshold input */}
      <div className="gap-2xs flex min-w-0 flex-1 items-center">
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
        {positionLabel !== undefined ? (
          <span className="text-muted-foreground text-xs whitespace-nowrap">{positionLabel}</span>
        ) : null}
      </div>

      {/* Remove button */}
      <button
        type="button"
        aria-label={removeLabel}
        disabled={total <= 2}
        onClick={() => onRemove(index)}
        className={cn(
          'text-muted-foreground hover:text-destructive focus-visible:ring-ring rounded p-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-30',
        )}
      >
        &times;
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreviewStrip
// ---------------------------------------------------------------------------

interface PreviewStripProps {
  buckets: MarginBucket[];
  enabled: boolean;
}

function PreviewStrip({ buckets, enabled }: PreviewStripProps): React.ReactElement {
  return (
    <div className="gap-xs flex flex-wrap">
      {PREVIEW_VALUES.map((v) => {
        const style = marginColorStyle(String(v), { enabled, buckets });
        return (
          <span
            key={v}
            className={cn('text-sm font-medium tabular-nums', style.className)}
            style={style.style}
          >
            {v > 0 ? `+${v}%` : `${v}%`}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarginColoringSettings
// ---------------------------------------------------------------------------

/**
 * "Kar Marji Renklendirme" settings card — a sibling to the other Tercihler
 * sections. Composes SettingsCardHeader + SettingsRow + BucketRow list +
 * live PreviewStrip + save via useUpdateMyPreferences.
 *
 * Initializes local state from useMyPreferences (or DEFAULT_MARGIN_BUCKETS
 * when unset). All state derived during render — no useEffect-for-derived-state.
 * React-Compiler-clean.
 */
export function MarginColoringSettings(): React.ReactElement {
  const t = useTranslations('settings.marginColoring');
  const { data: preferences } = useMyPreferences();
  const updateMutation = useUpdateMyPreferences();

  // ── Local state ────────────────────────────────────────────────────────────
  // Initialized lazily from preferences; re-initialized from preferences when
  // the query first resolves (via key prop strategy on the card below keeps this
  // simple: we use a separate initialized flag to sync once).

  const serverBuckets: readonly MarginBucket[] =
    preferences?.marginColoring?.buckets ?? DEFAULT_MARGIN_BUCKETS;
  const serverEnabled: boolean = preferences?.marginColoring?.enabled ?? false;

  const [initialized, setInitialized] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [buckets, setBuckets] = React.useState<MarginBucket[]>(Array.from(DEFAULT_MARGIN_BUCKETS));
  const [validationError, setValidationError] = React.useState<'ascending' | 'range' | null>(null);

  // Sync from server once when preferences first arrive.
  // This is NOT useEffect-for-derived-state — it's a one-time initialization
  // from async data (acceptable and React-Compiler-safe as a guarded setState).
  if (!initialized && preferences !== undefined) {
    setInitialized(true);
    setEnabled(serverEnabled);
    setBuckets(Array.from(serverBuckets));
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleColorChange(index: number, color: string): void {
    setBuckets((prev) => prev.map((b, i) => (i === index ? { ...b, color } : b)));
    setValidationError(null);
  }

  function handleThresholdChange(index: number, value: number): void {
    setBuckets((prev) => prev.map((b, i) => (i === index ? { ...b, threshold: value } : b)));
    setValidationError(null);
  }

  function handleAddBucket(): void {
    if (buckets.length >= 8) return;
    // New bucket threshold = last threshold + 10; default color = last bucket's color.
    const last = buckets[buckets.length - 1]!;
    setBuckets((prev) => [...prev, { threshold: last.threshold + 10, color: last.color }]);
    setValidationError(null);
  }

  function handleRemoveBucket(index: number): void {
    if (buckets.length <= 2) return;
    setBuckets((prev) => prev.filter((_, i) => i !== index));
    setValidationError(null);
  }

  function handlePresetChange(preset: PresetKey): void {
    setBuckets(Array.from(PRESET_SCALES[preset]));
    setValidationError(null);
  }

  function handleSave(): void {
    const err = validateBuckets(buckets);
    if (err !== null) {
      setValidationError(err.type);
      return;
    }
    setValidationError(null);
    updateMutation.mutate(
      { marginColoring: { enabled, buckets } },
      {
        onSuccess: () => {
          toast.success(t('savedToast'));
        },
      },
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const atMax = buckets.length >= 8;
  const isPending = updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <SettingsCardHeader
        icon={<DOMAIN_ICONS.theme />}
        title={t('title')}
        description={t('description')}
        // No status — this is a real, wired section.
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
          {/* ── Enable row ─────────────────────────────────────────────────── */}
          <SettingsRow
            htmlFor="margin-coloring-enabled"
            icon={<DOMAIN_ICONS.theme />}
            title={t('enableLabel')}
            description={t('enableDescription')}
            control={
              <Switch
                id="margin-coloring-enabled"
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked)}
                aria-label={t('enableLabel')}
              />
            }
          />

          <Separator variant="muted" />

          {/* ── Preset selector ─────────────────────────────────────────────── */}
          <div className="gap-2xs flex flex-col">
            <label className="text-foreground text-sm font-medium" htmlFor="margin-preset">
              {t('presetLabel')}
            </label>
            <Select onValueChange={(v) => handlePresetChange(v as PresetKey)}>
              <SelectTrigger id="margin-preset" className="w-48" aria-label={t('presetLabel')}>
                <SelectValue placeholder={t('presetLabel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="redGreen">{t('presetRedGreen')}</SelectItem>
                <SelectItem value="colorblind">{t('presetColorblind')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator variant="muted" />

          {/* ── Bucket list ─────────────────────────────────────────────────── */}
          <div className="gap-sm flex flex-col">
            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-sm font-medium">{t('bucketsTitle')}</span>
              <span className="text-muted-foreground text-2xs">{t('bucketsDescription')}</span>
            </div>

            <div className="gap-xs flex flex-col">
              {buckets.map((bucket, index) => (
                <BucketRow
                  key={index}
                  bucket={bucket}
                  index={index}
                  total={buckets.length}
                  onColorChange={handleColorChange}
                  onThresholdChange={handleThresholdChange}
                  onRemove={handleRemoveBucket}
                  pickColorLabel={t('pickColor')}
                  thresholdLabel={t('thresholdLabel')}
                  andBelowLabel={t('andBelow')}
                  andAboveLabel={t('andAbove')}
                  removeLabel={t('removeBucket')}
                />
              ))}
            </div>

            {/* Validation error */}
            {validationError !== null ? (
              <p className="text-destructive text-xs" role="alert">
                {validationError === 'ascending' ? t('errorAscending') : t('errorRange')}
              </p>
            ) : null}

            {/* Add bucket button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={atMax}
              onClick={handleAddBucket}
              className="w-fit"
            >
              {t('addBucket')}
            </Button>
          </div>

          <Separator variant="muted" />

          {/* ── Live preview ────────────────────────────────────────────────── */}
          <div className="gap-xs flex flex-col">
            <div className="gap-3xs flex flex-col">
              <span className="text-foreground text-sm font-medium">{t('previewTitle')}</span>
              <span className="text-muted-foreground text-2xs">{t('previewDescription')}</span>
            </div>
            <PreviewStrip buckets={buckets} enabled={enabled} />
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" disabled={isPending}>
            {t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
