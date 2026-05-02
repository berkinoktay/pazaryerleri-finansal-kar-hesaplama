'use client';

import { Cancel01Icon, CloudUploadIcon, Csv02Icon } from 'hugeicons-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Single-file dropzone with click-to-browse + drag-and-drop. Tuned for
 * the settlement-CSV import flow (Trendyol hakediş upload) where the
 * user picks one file, validates, then commits in a separate step. For
 * multi-file uploads (product image batch, future) build a sibling
 * `MultiFileUpload` rather than overloading this component.
 *
 * Controlled — caller owns the `File` reference and handles the upload
 * itself. The component validates `accept` + `maxSize` locally and
 * surfaces a localized error message via the `error` prop, so the
 * caller can also push server-side validation errors into the same
 * slot for consistent UX.
 *
 * The hidden `<input type="file">` is reset after every change so the
 * native picker fires `onChange` even when the user re-selects the
 * same file — without the reset, browsers suppress the second event
 * because `input.value` hasn't changed, and the user sees nothing
 * happen on a retry.
 *
 * @useWhen accepting a single file via dropzone + browse button (CSV import, document upload) — for multi-file scenarios build a MultiFileUpload variant
 */

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;
const KB_DECIMALS = 0;
const MB_DECIMALS = 1;

function formatFileSize(bytes: number): string {
  if (bytes >= BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_MB).toFixed(MB_DECIMALS)} MB`;
  }
  return `${(bytes / BYTES_PER_KB).toFixed(KB_DECIMALS)} KB`;
}

export interface FileUploadProps {
  /** Controlled value. `null` = empty dropzone. */
  value?: File | null;
  /** Fires after successful local validation, or with `null` on remove. */
  onChange?: (next: File | null) => void;
  /**
   * Native `accept` attribute for the file picker AND extension
   * filter for drag-drop validation. Pass like `"text/csv,.csv"` —
   * the leading-dot extensions are matched case-insensitively against
   * the dropped filename's suffix.
   */
  accept?: string;
  /** Local size cap in bytes. Files above this fail with `errorTooLarge`. */
  maxSize?: number;
  /**
   * External error message rendered below the dropzone — pass server-
   * side validation copy here so the surface stays consistent. When
   * set, the dropzone border switches to destructive.
   */
  error?: string | null;
  /** Async upload in flight — replaces the file row CTA with a spinner. */
  loading?: boolean;
  /** Disables the dropzone entirely. */
  disabled?: boolean;
  /** Localized prompt above the browse button. Defaults to a generic copy. */
  prompt?: string;
  /** Localized hint under the prompt — typically `"CSV · max 5MB"`. */
  hint?: string;
  /** Localized "browse" CTA label. */
  ctaLabel?: string;
  /** Localized error copy when the dropped file's type is rejected by `accept`. */
  errorWrongType?: string;
  /** Localized error copy when the file exceeds `maxSize`. */
  errorTooLarge?: string;
  /** Localized aria-label for the remove button. */
  removeLabel?: string;
  className?: string;
}

function fileMatchesAccept(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return true;
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  const filenameLower = file.name.toLowerCase();
  const mimeLower = file.type.toLowerCase();

  return tokens.some((token) => {
    if (token.startsWith('.')) {
      return filenameLower.endsWith(token);
    }
    if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1);
      return mimeLower.startsWith(prefix);
    }
    return mimeLower === token;
  });
}

export function FileUpload({
  value,
  onChange,
  accept,
  maxSize,
  error,
  loading = false,
  disabled = false,
  prompt = 'Dosyayı sürükle veya seç',
  hint,
  ctaLabel = 'Dosya seç',
  errorWrongType = 'Bu dosya türü desteklenmiyor.',
  errorTooLarge = 'Dosya boyut sınırını aşıyor.',
  removeLabel = 'Dosyayı kaldır',
  className,
}: FileUploadProps): React.ReactElement {
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragCounterRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const effectiveError = error ?? localError;
  const hasFile = value !== undefined && value !== null;

  const validateAndCommit = (file: File): void => {
    if (!fileMatchesAccept(file, accept)) {
      setLocalError(errorWrongType);
      return;
    }
    if (maxSize !== undefined && file.size > maxSize) {
      setLocalError(errorTooLarge);
      return;
    }
    setLocalError(null);
    onChange?.(file);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Reset the input so the next pick of the same file still fires onChange.
    event.target.value = '';
    if (file === undefined) return;
    validateAndCommit(file);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled) return;
    event.preventDefault();
    dragCounterRef.current += 1;
    if (event.dataTransfer.items.length > 0) setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled) return;
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled) return;
    // Required for `drop` to fire — without preventDefault the browser
    // navigates to the file URL on release.
    event.preventDefault();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled) return;
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file === undefined) return;
    validateAndCommit(file);
  };

  const handleRemove = (): void => {
    setLocalError(null);
    onChange?.(null);
  };

  const handleBrowseClick = (): void => {
    inputRef.current?.click();
  };

  if (hasFile) {
    return (
      <div
        className={cn(
          'gap-sm border-border bg-background p-sm flex items-center rounded-md border shadow-xs',
          effectiveError !== null && effectiveError !== undefined && 'border-destructive',
          disabled && 'opacity-60',
          className,
        )}
      >
        <span className="bg-muted text-muted-foreground [&_svg]:size-icon-sm flex size-9 shrink-0 items-center justify-center rounded-md">
          <Csv02Icon aria-hidden />
        </span>
        <div className="gap-3xs flex min-w-0 flex-1 flex-col">
          <span className="text-foreground truncate text-sm font-medium">{value.name}</span>
          <span className="text-2xs text-muted-foreground tabular-nums">
            {formatFileSize(value.size)}
          </span>
          {effectiveError !== null && effectiveError !== undefined ? (
            <span className="text-2xs text-destructive">{effectiveError}</span>
          ) : null}
        </div>
        {loading ? (
          <Spinner className="text-muted-foreground" />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
            aria-label={removeLabel}
            className="size-icon-lg p-0"
          >
            <Cancel01Icon className="size-icon-sm" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('gap-3xs flex flex-col', className)}>
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled && !loading) handleBrowseClick();
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (disabled || loading) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleBrowseClick();
          }
        }}
        aria-disabled={disabled || undefined}
        className={cn(
          'gap-sm py-lg px-md flex flex-col items-center justify-center rounded-md border-2 border-dashed text-center',
          'duration-fast cursor-pointer transition-colors',
          isDragging
            ? 'border-ring bg-info-surface'
            : effectiveError !== null && effectiveError !== undefined
              ? 'border-destructive bg-background'
              : 'border-border bg-background hover:border-border-strong',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="bg-muted text-muted-foreground [&_svg]:size-icon flex size-12 items-center justify-center rounded-full">
          <CloudUploadIcon aria-hidden />
        </span>
        <div className="gap-3xs flex flex-col">
          <span className="text-foreground text-sm font-medium">{prompt}</span>
          {hint !== undefined ? (
            <span className="text-2xs text-muted-foreground">{hint}</span>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} tabIndex={-1}>
          {ctaLabel}
        </Button>
      </div>
      {effectiveError !== null && effectiveError !== undefined ? (
        <span className="text-2xs text-destructive">{effectiveError}</span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        disabled={disabled}
        aria-invalid={effectiveError !== null && effectiveError !== undefined ? true : undefined}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />
    </div>
  );
}
