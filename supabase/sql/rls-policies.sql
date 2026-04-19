-- Row-Level Security policies for multi-tenant isolation.
-- Applied after Prisma's `db push` via `pnpm db:apply-policies`.
--
-- Design principles:
--   - Policies target the `authenticated` role. The `postgres` superuser
--     (which our Prisma DATABASE_URL uses today) bypasses RLS entirely,
--     so backend service-role queries continue to work unchanged.
--   - Only SELECT policies are defined in Phase A. INSERT/UPDATE/DELETE
--     have no policy, which means default-deny for non-superuser roles.
--     CRUD endpoints add their own policies when they land.
--   - All policies use `auth.uid()`, which Supabase provides out of the
--     box to read the JWT `sub` claim.
--   - Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY so
--     `pnpm db:apply-policies` can run repeatedly without conflict.

-- ─── user_profiles ─────────────────────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_self_read ON user_profiles;
CREATE POLICY user_profiles_self_read ON user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- ─── organizations ─────────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_member_read ON organizations;
CREATE POLICY organizations_member_read ON organizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );
