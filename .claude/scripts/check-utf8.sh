#!/usr/bin/env bash
# PostToolUse hook (Edit|Write), main conversation and subagents alike.
# Catches the known failure where a multi-byte UTF-8 character loses its lead
# byte (e.g. an em-dash written as 80 94 instead of e2 80 94). The edit already
# happened; exit 2 shows stderr to the model so it repairs the file right away.
# Bash 3.2 compatible, ASCII-only on purpose.
set -u

TEXT_EXT_RE='\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|sql|prisma|css|scss|ya?ml|sh|txt|html)$'

FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0
printf '%s' "$FILE" | grep -Eq "$TEXT_EXT_RE" || exit 0

BAD=$(perl -MEncode -ne '
  my $line = $_;
  eval { Encode::decode("UTF-8", $line, Encode::FB_CROAK); 1 } or print "$.\n";
' < "$FILE" | head -n 10 | tr '\n' ' ')

[ -z "$BAD" ] && exit 0

{
  echo "INVALID UTF-8 in $FILE (line(s): $BAD)."
  echo "A multi-byte character lost its lead byte. Re-write those lines with the Edit/Write tool"
  echo "(not sed/echo/heredoc) and prefer ASCII in comments and test names."
} >&2
exit 2
