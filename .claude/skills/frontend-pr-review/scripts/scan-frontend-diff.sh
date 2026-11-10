#!/usr/bin/env bash
# Frontend PR review — mechanical scanner.
# Lists changed apps/web frontend files (branch diff vs origin/main merge-base
# + staged + unstaged) and greps them for high-precision rule-violation
# candidates. Output is CANDIDATES, not verdicts — the reviewer must read the
# surrounding code and discard false positives (especially rows marked heuristic).
#
# Usage: bash .claude/skills/frontend-pr-review/scripts/scan-frontend-diff.sh
set -euo pipefail

# --- locate repo root ---
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository." >&2
  exit 1
fi
cd "$ROOT"

# --- determine the base commit to diff against ---
BASE=""
for ref in origin/main main origin/master master; do
  if git rev-parse --verify --quiet "$ref" >/dev/null; then
    BASE="$(git merge-base HEAD "$ref" 2>/dev/null || true)"
    [ -n "$BASE" ] && break
  fi
done

# --- collect changed files: committed-on-branch + staged + unstaged ---
{
  [ -n "$BASE" ] && git diff --name-only "$BASE"...HEAD
  git diff --name-only            # unstaged
  git diff --name-only --cached   # staged
} 2>/dev/null \
  | sort -u \
  | grep -E '^apps/web/src/.*\.(ts|tsx|css)$' \
  | { grep -vE '\.(test|spec)\.(ts|tsx)$|/__tests__/' || true; } \
  > /tmp/_fe_review_files.txt || true

# test files are reviewed under their own rules; keep a separate list
{
  [ -n "$BASE" ] && git diff --name-only "$BASE"...HEAD
  git diff --name-only
  git diff --name-only --cached
} 2>/dev/null \
  | sort -u \
  | grep -E '^apps/web/.*(\.(test|spec)\.(ts|tsx)$|/tests/)' \
  > /tmp/_fe_review_test_files.txt || true

# read into arrays portably (macOS ships bash 3.2 — no mapfile)
FILES=()
while IFS= read -r _line; do [ -n "$_line" ] && FILES+=("$_line"); done < /tmp/_fe_review_files.txt
TEST_FILES=()
while IFS= read -r _line; do [ -n "$_line" ] && TEST_FILES+=("$_line"); done < /tmp/_fe_review_test_files.txt

echo "=== CHANGED FRONTEND FILES (${#FILES[@]} src, ${#TEST_FILES[@]} test) ==="
if [ "${#FILES[@]}" -eq 0 ] && [ "${#TEST_FILES[@]}" -eq 0 ]; then
  echo "(none — no apps/web frontend changes vs ${BASE:-'(no base found)'})"
  exit 0
fi
printf '%s\n' ${FILES[@]+"${FILES[@]}"} ${TEST_FILES[@]+"${TEST_FILES[@]}"} | sed '/^$/d'
echo

# --- helper: grep a pattern across the src file list, print "RULE  file:line: text" ---
scan() {
  local rule="$1" pattern="$2"; shift 2
  local files=("$@")
  [ "${#files[@]}" -eq 0 ] && return 0
  local hits
  hits="$(grep -nE "$pattern" "${files[@]}" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "--- $rule ---"
    # grep -n with multiple files prints "file:line:text"
    echo "$hits" | sed 's/^/  /'
    echo
  fi
}

# scan but drop lines whose "file:line:text" matches the exclude regex
# (used to strip import aliases / comment lines from noisy heuristics)
scan_exclude() {
  local rule="$1" pattern="$2" exclude="$3"; shift 3
  local files=("$@")
  [ "${#files[@]}" -eq 0 ] && return 0
  local hits
  hits="$(grep -nE "$pattern" "${files[@]}" 2>/dev/null | grep -vE "$exclude" || true)"
  if [ -n "$hits" ]; then
    echo "--- $rule ---"
    echo "$hits" | sed 's/^/  /'
    echo
  fi
}

echo "=== MECHANICAL CANDIDATES (verify each before reporting) ==="
echo

if [ "${#FILES[@]}" -gt 0 ]; then
  # 🔴 high-consequence
  scan "RAW_FETCH (🔴 use typed apiClient)" '(^|[^.[:alnum:]])fetch\(' "${FILES[@]}"
  scan "CONSOLE_LOG (🔴 if sensitive data / 🟡 stray)" 'console\.(log|debug|info|warn)\(' "${FILES[@]}"
  scan "DATE_OR_RANDOM_IN_CLIENT (🔴 heuristic — only in render path of 'use client')" '(new Date\(|Date\.now\(|Math\.random\()' "${FILES[@]}"
  scan "CROSS_FEATURE_IMPORT (🔴 heuristic — verify importer is another feature)" "from ['\"]@/features/" "${FILES[@]}"

  # 🟡 tokens / tailwind
  scan "ARBITRARY_TW_VALUE (🟡 extend tokens)" '(bg|text|border|fill|ring|stroke|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|gap|space-[xy]|rounded|shadow|top|left|right|bottom|inset|size|leading|tracking)-\[' "${FILES[@]}"
  scan "T3_MAX_W (🟡 use role tokens)" '\bmax-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)\b' "${FILES[@]}"
  scan "HEX_COLOR (🟡 heuristic — legit only in tokens/*.css)" '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b' "${FILES[@]}"
  scan "INLINE_STYLE (🟡 needs // runtime-dynamic comment)" 'style=\{\{' "${FILES[@]}"
  scan "ALPHA_SHORTCUT (🟡 heuristic — repeated = missing token)" '(bg|text|border|ring|fill|stroke|from|to|via)-[a-z-]+/[0-9]{1,2}\b' "${FILES[@]}"
  scan "CLASSNAME_CONCAT (🟡 use cn() — heuristic)" 'className=\{["\x27][^}]*["\x27] *\+' "${FILES[@]}"
  scan "LEFT_BORDER_ACCENT (🟡 heuristic — no left accent bar)" 'border-l(-[0-9])?\b' "${FILES[@]}"

  # 🟡 react / state / query
  scan "USE_EFFECT (🟡 heuristic — derive in render unless syncing external)" '\buseEffect\(' "${FILES[@]}"
  scan "ZUSTAND_CREATE (🟡 heuristic — not for server data)" "from ['\"]zustand['\"]|\bcreate\(\(set" "${FILES[@]}"
  scan "HANDROLLED_TOAST (🟡 heuristic — prefer global onError)" 'toast\.(error|success|warning)\(' "${FILES[@]}"

  # 🟡 typescript discipline
  scan "TS_ANY (🟡)" '(:[[:space:]]*any\b|<any>|\bas any\b|Array<any>)' "${FILES[@]}"
  scan_exclude "TS_ASSERTION (🟡 heuristic — real 'expr as Type')" '[]a-zA-Z0-9_)] as [A-Z][A-Za-z0-9_]' '\bas const\b|:[0-9]+:[[:space:]]*(import|\*|//|/\*)' "${FILES[@]}"
  scan "TS_IGNORE (🟡)" '@ts-(ignore|expect-error|nocheck)' "${FILES[@]}"

  # 🟡 i18n (inline Turkish text in JSX — heuristic)
  scan "INLINE_TURKISH (🟡 heuristic — use next-intl)" '>[^<>{}]*[çğıöşüÇĞİÖŞÜ][^<>{}]*<' "${FILES[@]}"

  # 🟡 next.js
  scan "SYNC_PARAMS (🟡 heuristic — params/searchParams are async in Next 16)" 'params:[[:space:]]*\{[^}]*:[[:space:]]*string' "${FILES[@]}"

  # 🟡 DataTable assembly contract (standardization epic rot-prevention)
  scan "RAW_SEARCH_INPUT (🟡 use DataTableToolbar search / SearchInput)" 'Search01Icon[^<]*(className)' "${FILES[@]}"
  scan "RAW_SELECT_FILTER (🟡 heuristic — ≥2 in a toolbar file = advancedFilter catalog candidate)" '<SelectTrigger' "${FILES[@]}"
  # Two forms: typed (useState<StatusFilter>) AND the more common untyped one
  # where only the VARIABLE name betrays it (const [typeFilter, setTypeFilter]
  # = useState('')) — the untyped form was a verified false negative.
  scan "FILTER_STATE_IN_USESTATE (🟡 heuristic — filters/tabs belong in nuqs URL state)" '(useState[^;]*([Ff]ilter|[Tt]ab[^l]|statusFilter|searchValue)|const \[(q|query|search[[:alnum:]]*|[[:alnum:]]*[Ff]ilter[[:alnum:]]*|[[:alnum:]]*[Tt]ab|show[A-Z][[:alnum:]]*|status[A-Z]?[[:alnum:]]*), [[:alnum:]]+\] = (React\.)?useState)' "${FILES[@]}"
fi

if [ "${#TEST_FILES[@]}" -gt 0 ]; then
  echo "=== TEST-FILE CANDIDATES ==="
  echo
  scan "TEST_GETBYTESTID (🟡 prefer getByRole)" 'getByTestId|queryByTestId|findByTestId' "${TEST_FILES[@]}"
  scan "TEST_FIREEVENT (🟡 prefer userEvent)" '\bfireEvent\b' "${TEST_FILES[@]}"
  scan "TEST_JSDOM (🟡 use happy-dom)" 'jsdom' "${TEST_FILES[@]}"
  scan "TEST_MOCK_APICLIENT (🟡 use MSW)" "vi\.mock\(['\"]@pazarsync/api-client" "${TEST_FILES[@]}"
  scan "TEST_SNAPSHOT (🟡 no snapshot tests)" 'toMatchSnapshot|toMatchInlineSnapshot' "${TEST_FILES[@]}"
fi

echo "=== END SCAN ==="
