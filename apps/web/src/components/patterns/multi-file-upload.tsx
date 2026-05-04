'use client';

import { Add01Icon, CloudUploadIcon, Delete02Icon } from 'hugeicons-react';
import * as React from 'react';

import {
  FileRow,
  fileMatchesAccept,
  type FileUploadProps,
} from '@/components/patterns/file-upload';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Multi-file dropzone — same empty-state shape as `FileUpload`, but
 * filled state renders a vertical list of files plus a header row
 * with `Files (N)` count and "Add files" / "Remove all" actions.
 *
 * Per-file progress is callsite-driven: pass a `progress` map indexed
 * by file order (0-based), values 0–100. Files without an entry render
 * with no progress bar — useful for staged flows where some files have
 * uploaded and some are queued.
 *
 * Same controlled contract as FileUpload: caller owns the `File[]`
 * array and runs the upload itself. Validation (`accept`, `maxSize`,
 * `maxFiles`) runs locally before each commit and surfaces a localized
 * error in the same surface as the empty state's `error` prop.
 *
 * @useWhen accepting multiple files (image batch upload, attachment set, multi-document import) — for one-shot single-file flows use FileUpload
 */

export interface MultiFileUploadProps extends Omit<
  FileUploadProps,
  'value' | 'onChange' | 'progress'
> {
  /** Controlled file list. */
  value?: File[];
  /** Fires after every successful add / remove with the next list. */
  onChange?: (next: File[]) => void;
  /**
   * Per-file upload progress, 0–100, indexed by position in the list.
   * Files without an entry render the row without a progress bar.
   */
  progress?: Record<number, number>;
  /** Cap on the total number of files. Adds beyond this fail with `errorTooMany`. */
  maxFiles?: number;
  /** Localized error copy when an add would exceed `maxFiles`. */
  errorTooMany?: string;
  /** Localized header label — `"Files"` segment of `Files (6)`. */
  filesCountLabel?: string;
  /** Localized "Add files" CTA in the filled-state header. */
  addLabel?: string;
  /** Localized "Remove all" CTA in the filled-state header. */
  removeAllLabel?: string;
}

export function MultiFileUpload({
  value,
  onChange,
  accept,
  maxSize,
  maxFiles,
  progress,
  error,
  loading = false,
  disabled = false,
  prompt = 'Dosyaları sürükle veya seç',
  hint,
  ctaLabel = 'Dosya seç',
  errorWrongType = 'Bu dosya türü desteklenmiyor.',
  errorTooLarge = 'Dosya boyut sınırını aşıyor.',
  errorTooMany = 'Maksimum dosya sayısını aştın.',
  removeLabel = 'Dosyayı kaldır',
  filesCountLabel = 'Dosyalar',
  addLabel = 'Dosya ekle',
  removeAllLabel = 'Tümünü kaldır',
  emptyIcon,
  progressLabel = 'Yükleme ilerlemesi',
  className,
}: MultiFileUploadProps): React.ReactElement {
  const files = value ?? [];
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragCounterRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const effectiveError = error ?? localError;
  const hasFiles = files.length > 0;

  const validateAndCommit = (incoming: File[]): void => {
    if (incoming.length === 0) return;
    if (maxFiles !== undefined && files.length + incoming.length > maxFiles) {
      setLocalError(errorTooMany);
      return;
    }
    for (const file of incoming) {
      if (!fileMatchesAccept(file, accept)) {
        setLocalError(errorWrongType);
        return;
      }
      if (maxSize !== undefined && file.size > maxSize) {
        setLocalError(errorTooLarge);
        return;
      }
    }
    setLocalError(null);
    onChange?.([...files, ...incoming]);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files;
    // Reset so picking the same file twice still fires onChange.
    event.target.value = '';
    if (picked === null || picked.length === 0) return;
    validateAndCommit(Array.from(picked));
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
    event.preventDefault();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (disabled) return;
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const dropped = event.dataTransfer.files;
    if (dropped.length === 0) return;
    validateAndCommit(Array.from(dropped));
  };

  const handleRemove = (index: number): void => {
    setLocalError(null);
    const next = files.filter((_, i) => i !== index);
    onChange?.(next);
  };

  const handleRemoveAll = (): void => {
    setLocalError(null);
    onChange?.([]);
  };

  const handleBrowseClick = (): void => {
    inputRef.current?.click();
  };

  if (hasFiles) {
    return (
      <div className={cn('gap-sm flex flex-col', className)}>
        <div className="gap-sm flex items-center justify-between">
          <span className="text-foreground text-sm font-semibold">
            {filesCountLabel} ({files.length})
          </span>
          <div className="gap-xs flex items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBrowseClick}
              disabled={disabled || loading}
            >
              <Add01Icon className="size-icon-sm" aria-hidden />
              {addLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemoveAll}
              disabled={disabled || loading}
            >
              <Delete02Icon className="size-icon-sm" aria-hidden />
              {removeAllLabel}
            </Button>
          </div>
        </div>
        <ul className="gap-xs flex flex-col">
          {files.map((file, index) => {
            const fileProgress = progress?.[index];
            return (
              <li key={`${file.name}-${file.size}-${index}`}>
                <FileRow
                  file={file}
                  progress={fileProgress ?? null}
                  loading={loading}
                  disabled={disabled}
                  error={null}
                  onRemove={() => handleRemove(index)}
                  removeLabel={removeLabel}
                  progressLabel={progressLabel}
                  showImagePreview
                />
              </li>
            );
          })}
        </ul>
        {effectiveError !== null && effectiveError !== undefined ? (
          <span className="text-2xs text-destructive">{effectiveError}</span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          onChange={handleInputChange}
          disabled={disabled}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />
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
              ? 'border-destructive bg-input'
              : 'border-border bg-input hover:border-border-strong',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="bg-muted text-muted-foreground [&_svg]:size-icon flex size-12 items-center justify-center rounded-full">
          {emptyIcon ?? <CloudUploadIcon aria-hidden />}
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
        multiple
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
