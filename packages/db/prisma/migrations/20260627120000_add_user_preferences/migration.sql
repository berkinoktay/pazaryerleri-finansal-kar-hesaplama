-- Add preferences JSONB column to user_profiles.
--
-- Stores per-user UI preferences (e.g. margin-coloring scale) as a JSONB blob.
-- Default '{}' means existing rows are unaffected and new rows start with no
-- preferences set (opt-in). The column is user_profiles-scoped; existing RLS
-- policies (user_profiles_self_read, user_profiles_self_update) already gate
-- all reads/writes on `id = auth.uid()` — no new policy needed.

ALTER TABLE "user_profiles"
  ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
