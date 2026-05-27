-- Member ↔ Store access grants (member/org/store access-control — Phase 2)
--
-- MemberStoreAccess scopes which stores a MEMBER/VIEWER may see. OWNER/ADMIN
-- see every store in their org by role and need no rows here. A grant is scoped
-- to a membership (member_id → organization_members.id); deleting the member
-- cascades its grants. organization_id is denormalized for flat RLS + indexing
-- (same pattern as products / sync_logs). granted_by is an audit pointer to the
-- granting OrganizationMember.id (plain uuid, no FK).
--
-- RLS NOTE: the can_access_store() helper and the rewritten store-scoped SELECT
-- policies live canonically in supabase/sql/rls-policies.sql and are applied via
-- `pnpm db:apply-policies` (the same mechanism as is_org_member and every other
-- policy in this project — none of them live in migrations). This migration
-- carries only the table DDL.

-- CreateTable
CREATE TABLE "member_store_access" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_store_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_store_access_store_id_idx" ON "member_store_access"("store_id");

-- CreateIndex
CREATE INDEX "member_store_access_organization_id_idx" ON "member_store_access"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_store_access_member_id_store_id_key" ON "member_store_access"("member_id", "store_id");

-- AddForeignKey
ALTER TABLE "member_store_access" ADD CONSTRAINT "member_store_access_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_store_access" ADD CONSTRAINT "member_store_access_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_store_access" ADD CONSTRAINT "member_store_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
