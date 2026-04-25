-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "last_accessed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_org_members_user_last_accessed" ON "organization_members"("user_id", "last_accessed_at" DESC);
