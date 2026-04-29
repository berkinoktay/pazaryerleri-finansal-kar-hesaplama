-- Promote sync_log.error_code from free-form String to typed enum.
-- Existing rows with values outside the enum (e.g. 'EAGAIN' from a Node
-- net error that leaked through the old free-form column) are coerced
-- to 'INTERNAL_ERROR'. The original diagnostic remains in error_message.
CREATE TYPE "SyncErrorCode" AS ENUM (
  'MARKETPLACE_AUTH_FAILED',
  'MARKETPLACE_ACCESS_DENIED',
  'MARKETPLACE_UNREACHABLE',
  'SYNC_IN_PROGRESS',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR'
);

ALTER TABLE "sync_logs"
  ALTER COLUMN "error_code" TYPE "SyncErrorCode"
  USING (
    CASE
      WHEN "error_code" IS NULL THEN NULL
      WHEN "error_code" IN (
        'MARKETPLACE_AUTH_FAILED',
        'MARKETPLACE_ACCESS_DENIED',
        'MARKETPLACE_UNREACHABLE',
        'SYNC_IN_PROGRESS',
        'RATE_LIMITED',
        'VALIDATION_ERROR',
        'INTERNAL_ERROR'
      ) THEN "error_code"::"SyncErrorCode"
      ELSE 'INTERNAL_ERROR'::"SyncErrorCode"
    END
  );
