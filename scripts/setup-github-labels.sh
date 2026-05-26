#!/usr/bin/env bash
# Idempotent GitHub label taxonomy for PazarSync. Re-runnable (--force upserts).
set -euo pipefail

REPO="berkinoktay/pazaryerleri-finansal-kar-hesaplama"
upsert() { gh label create "$1" --color "$2" --description "$3" --force --repo "$REPO"; }

# type
upsert "bug"           "d73a4a" "Beklenmeyen davranış / hata"
upsert "enhancement"   "a2eeef" "Yeni özellik veya iyileştirme"
upsert "documentation" "0075ca" "Doküman değişikliği"
upsert "tech-debt"     "fbca04" "Teknik borç / refactor / bakım"
upsert "security"      "b60205" "Güvenlik ile ilgili"
upsert "ci-build"      "0e8a16" "CI / build / pipeline"
# priority
upsert "P0" "b60205" "Acil — şimdi"
upsert "P1" "d93f0b" "Yüksek öncelik"
upsert "P2" "fbca04" "Normal öncelik"
upsert "P3" "c2e0c6" "Düşük öncelik"
# area
upsert "area: web"  "1d76db" "apps/web"
upsert "area: api"  "5319e7" "apps/api"
upsert "area: db"   "006b75" "packages/db"
upsert "area: sync" "0e8a16" "sync worker / edge functions"
upsert "area: ci"   "bfd4f2" ".github / CI / scripts"
upsert "area: docs" "bfdadc" "docs/"
# status
upsert "blocked" "000000" "Başka bir iş tarafından engellendi"

# Remove OSS-community defaults that don't fit a solo private SaaS.
for L in "good first issue" "help wanted"; do
  gh label delete "$L" --yes --repo "$REPO" 2>/dev/null || true
done

echo "✓ Labels synced"
