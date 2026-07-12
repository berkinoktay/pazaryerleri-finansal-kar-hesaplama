-- CreateIndex
CREATE INDEX "sync_logs_organization_id_status_store_id_sync_type_complet_idx" ON "sync_logs"("organization_id", "status", "store_id", "sync_type", "completed_at" DESC);
