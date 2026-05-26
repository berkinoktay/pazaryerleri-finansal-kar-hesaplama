#!/usr/bin/env bash
# Free-tier merge hygiene for PazarSync: squash-only merges + auto-delete the
# merged head branch. These repo-level settings ARE available on Free-private
# (unlike branch protection / rulesets). Idempotent — safe to re-run.
set -euo pipefail

REPO="berkinoktay/pazaryerleri-finansal-kar-hesaplama"

# NOTE: allow_auto_merge is intentionally omitted — like branch protection, it
# is not honored on Free-private repos (the PATCH is silently ignored). Enable
# it alongside rulesets if/when the repo moves to GitHub Pro (see docs/CONTRIBUTING.md).
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true >/dev/null

echo "✓ Repo merge settings applied (squash-only + auto-delete branch)"
