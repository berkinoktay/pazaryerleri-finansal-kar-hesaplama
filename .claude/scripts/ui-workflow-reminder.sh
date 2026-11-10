#!/usr/bin/env bash
# UI Development Workflow Reminder
# UserPromptSubmit hook. On UI-signal prompts, prints a reminder
# to stdout (Claude Code injects it as additional context).
# Always exits 0 — missing keywords is the quiet path, not an error.
set -u

INPUT=$(cat)

# Prefer jq for safe JSON extraction; fall back to raw input if jq is missing.
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || printf '%s' "$INPUT")
else
  PROMPT="$INPUT"
fi

# Automated events (background-task notifications) are not user requests.
case "$PROMPT" in
  *"<task-notification>"*) exit 0 ;;
esac

# Only the user's own words count: drop pasted blocks (logs, transcripts, code
# dumps) — their generic vocabulary used to fire this hook on non-UI work.
PROMPT=$(printf '%s' "$PROMPT" | perl -0777 -pe 's/<pasted_content\b[^>]*>.*?<\/pasted_content\b[^>]*>//gs')

# Strong UI signals only. Generic words (list, view, table, token, render,
# design, style, panel, tablo, liste) were dropped: they also mean DB tables,
# marketplace panels and design docs in this repo.
EN_KEYWORDS='\b(ui|frontend|components?|tsx|jsx|shadcn|tailwind|apps/web|button|modal|dialog|drawer|sidebar|tooltip|landing page|dark mode)\b'
# Turkish is agglutinative — prefix match (sayfa → sayfasına, ekran → ekranı).
TR_KEYWORDS='\b(ekran|sayfa|tasarım|tasarim|bileşen|bilesen|arayüz|arayuz|buton)'

if printf '%s' "$PROMPT" | grep -qiE "$EN_KEYWORDS|$TR_KEYWORDS"; then
  cat <<'EOF'
UI workflow — before writing any UI, follow this cascade:
  1. Scan apps/web/src/components/patterns/   (PazarSync composites — KpiTile, DataTable, PageHeader, Currency, TrendDelta, SyncBadge, EmptyState, StatGroup, DateRangePicker, DataTableToolbar)
  2. Scan apps/web/src/components/ui/         (41 shadcn primitives already installed)
  3. Check shadcn registry — pnpm dlx shadcn@latest add <name>
  4. Custom only if 1–3 all miss. Compose from ui/ + patterns/. Never fork a primitive.

Dashboard aesthetic is locked in tokens: OKLCH palette, Host Grotesk, --space-*, shadow-* depth.
No new palettes or one-off colors — extend tokens instead.

Feature composites → apps/web/src/features/<feature>/components/
Cross-feature composites → promote to apps/web/src/components/patterns/

Invoke /ui-ux-pro-max for design decisions. Invoke /ui-design-system only when extending tokens/primitives.
Visual reference: /design/tokens · /design/primitives · /design/patterns (dev server).
EOF
fi

exit 0
