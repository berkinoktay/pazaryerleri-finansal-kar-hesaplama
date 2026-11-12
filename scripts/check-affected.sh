#!/bin/sh
# Affected-only fast gate: typecheck + lint + unit tests for the packages that
# differ from the base ref and every package that depends on them. Used by the
# husky pre-push hook and by `pnpm check:affected`.
#
# Component, integration and slow suites are CI's job (CI is the single
# authority). Resource bounds: at most 3 turbo tasks at once, 2 vitest workers
# each — the old full pre-push gate opened ~70 processes and froze the machine.
#
# Base ref: $TURBO_SCM_BASE, default origin/main. A stale base only widens the
# set (more packages checked), never narrows it.
set -e

base="${TURBO_SCM_BASE:-origin/main}"
if git rev-parse -q --verify "$base^{commit}" >/dev/null 2>&1; then
  export TURBO_SCM_BASE="$base"
  scope="--affected"
else
  # turbo errors out ("Unable to query SCM") on an unresolvable base instead of
  # widening the run, so fall back to every package ourselves.
  echo "check-affected: base '$base' not found; checking every package instead of the affected set" >&2
  scope=""
fi

# $scope is intentionally unquoted: when empty it must expand to no argument.
PAZARSYNC_TEST_WORKERS="${PAZARSYNC_TEST_WORKERS:-2}" exec pnpm turbo run typecheck lint test:unit $scope \
  --concurrency=3 --output-logs=errors-only
