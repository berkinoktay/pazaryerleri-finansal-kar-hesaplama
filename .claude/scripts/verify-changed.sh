#!/usr/bin/env bash
# SubagentStop gate for the `implementer` agent (wired in its frontmatter as a
# Stop hook; Claude Code converts it to SubagentStop for that agent only).
#
# The agent may not finish while the workspace packages it touched fail
# typecheck / lint / unit tests, or while a changed file holds invalid UTF-8.
# New code that matches a project-rule pattern (inline Turkish text, `as`
# assertions, float money) triggers ONE soft stop asking the agent to fix it or
# justify it in its final report.
#
# Exit 0 = allow the stop. Exit 2 = keep the agent working; stderr becomes its
# next instruction. Status for the orchestrator: .claude/state/verify-last.log
#
# Bash 3.2 compatible (macOS /bin/bash). Kept ASCII-only on purpose.
set -u

MAX_BLOCKS=3
TAIL_LINES=40
TEXT_EXT_RE='\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|sql|prisma|css|scss|ya?ml|sh|txt|html)$'
TEST_PATH_RE='(__tests__/|/tests/|\.test\.|\.spec\.|/generated/)'
MONEY_PATH_RE='^(packages/profit/|packages/order-sync/|apps/api/src/services/)'

INPUT=$(cat)
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$ROOT" 2>/dev/null || exit 0

STATE_DIR="$ROOT/.claude/state"
mkdir -p "$STATE_DIR"
find "$STATE_DIR" -name 'verify-a*' -mtime +1 -delete 2>/dev/null

AGENT_ID=$(printf '%s' "$INPUT" | jq -r '.agent_id // .session_id // "unknown"' 2>/dev/null)
[ -z "$AGENT_ID" ] && AGENT_ID=unknown
COUNTER="$STATE_DIR/verify-$AGENT_ID.count"
WARNED="$STATE_DIR/verify-$AGENT_ID.warned"
LAST_LOG="$STATE_DIR/verify-last.log"

stamp() { date '+%Y-%m-%dT%H:%M:%S'; }
log_status() { printf '%s %s agent=%s packages=%s\n' "$1" "$(stamp)" "$AGENT_ID" "$2" >> "$LAST_LOG"; }

CHANGED=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u )
if [ -z "$CHANGED" ]; then
  rm -f "$COUNTER"
  log_status PASS "-"
  exit 0
fi

PKGS=$(printf '%s\n' "$CHANGED" | awk -F/ '($1=="apps" || $1=="packages") && NF>2 {print $1"/"$2}' | sort -u)
PKG_LIST=$(printf '%s' "$PKGS" | tr '\n' ',' | sed 's/,$//')
[ -z "$PKG_LIST" ] && PKG_LIST="-"

FAILURES=""
add_failure() { FAILURES="${FAILURES}$1
"; }

# 1) UTF-8 validity of every changed text file.
while IFS= read -r f; do
  [ -f "$f" ] || continue
  printf '%s' "$f" | grep -Eq "$TEXT_EXT_RE" || continue
  if ! perl -MEncode -e 'local $/; my $d = <STDIN>; eval { Encode::decode("UTF-8", $d, Encode::FB_CROAK); 1 } or exit 1' < "$f"; then
    add_failure "INVALID UTF-8: $f contains broken multi-byte characters (a lead byte was dropped). Rewrite the affected lines with the Edit/Write tool, never sed/echo/heredoc."
  fi
done <<EOF
$CHANGED
EOF

# 2) typecheck -> lint -> unit tests, one package at a time (no parallelism).
for pkg in $PKGS; do
  [ -f "$pkg/package.json" ] || continue
  for script in typecheck lint test:unit; do
    OUT=$(pnpm --filter "./$pkg" run --if-present "$script" 2>&1)
    if [ $? -ne 0 ]; then
      add_failure "FAILED: pnpm --filter ./$pkg run $script
$(printf '%s\n' "$OUT" | tail -n "$TAIL_LINES")"
      break
    fi
  done
done

if [ -n "$FAILURES" ]; then
  COUNT=$(cat "$COUNTER" 2>/dev/null || echo 0)
  COUNT=$((COUNT + 1))
  printf '%s' "$COUNT" > "$COUNTER"
  if [ "$COUNT" -gt "$MAX_BLOCKS" ]; then
    log_status GAVE_UP "$PKG_LIST"
    exit 0
  fi
  log_status FAIL "$PKG_LIST"
  {
    echo "Verification gate ($COUNT/$MAX_BLOCKS): you may not report this step as done yet."
    echo "Fix the failures below inside the scope of your step, re-run the same command, then finish."
    echo "If a failure is outside your step or you cannot fix it, say so explicitly in your final report as RED - never call it green."
    echo
    printf '%s' "$FAILURES"
  } >&2
  exit 2
fi

rm -f "$COUNTER"

# 3) Soft rule scan on ADDED lines only (pre-existing code is not flagged).
added_lines() {
  if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
    git diff -U0 HEAD -- "$1" | grep '^+' | grep -v '^+++' | sed 's/^+//'
  else
    cat "$1"
  fi
}

WARNINGS=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  printf '%s' "$f" | grep -Eq '\.(ts|tsx)$' || continue
  printf '%s' "$f" | grep -Eq "$TEST_PATH_RE" && continue
  LINES=$(added_lines "$f")
  [ -z "$LINES" ] && continue
  HITS=$(printf '%s\n' "$LINES" | perl -CSD -ne '
    next if /^\s*(\/\/|\*|\/\*)/;
    print "  inline Turkish text: $_" if /[\x{e7}\x{11f}\x{131}\x{f6}\x{15f}\x{fc}\x{c7}\x{11e}\x{130}\x{d6}\x{15e}\x{dc}]/;
    print "  type assertion (as): $_" if /\bas\s+(?!const\b)[A-Za-z_\{\[\(]/ && !/^\s*(import|export)\b/;
  ')
  if printf '%s' "$f" | grep -Eq "$MONEY_PATH_RE"; then
    MONEY=$(printf '%s\n' "$LINES" | grep -En 'parseFloat[[:space:]]*\(|\.toFixed[[:space:]]*\(' | sed 's/^/  float money (use decimal.js): /')
    [ -n "$MONEY" ] && HITS="${HITS}
${MONEY}"
  fi
  [ -n "$(printf '%s' "$HITS" | tr -d '[:space:]')" ] && WARNINGS="${WARNINGS}${f}:
${HITS}
"
done <<EOF
$CHANGED
EOF

if [ -n "$WARNINGS" ] && [ ! -f "$WARNED" ]; then
  : > "$WARNED"
  log_status WARN "$PKG_LIST"
  {
    echo "Checks are green, but new lines match PazarSync rule patterns (CLAUDE.md):"
    echo "Turkish user-facing text goes through next-intl, no \`as\` assertions (use type guards), money uses decimal.js."
    echo "Fix each hit, or - if it is a false positive - name it in your final report with a one-line justification. Then finish."
    echo
    printf '%s' "$WARNINGS"
  } >&2
  exit 2
fi

log_status PASS "$PKG_LIST"
exit 0
