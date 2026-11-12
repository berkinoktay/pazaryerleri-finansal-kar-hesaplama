---
name: frontend-pr-review
description: >-
  PazarSync frontend pre-PR convention & UI/UX gate. Reviews the CHANGED frontend
  code (apps/web diff vs main) against the project's own living rules in root
  CLAUDE.md, apps/web/CLAUDE.md, docs/SECURITY.md, and the design memories — then
  reports every violation grouped by severity (blocker / warning / suggestion)
  with file:line, and auto-fixes only the unambiguous ones. Use this BEFORE
  opening any PR that touches apps/web, when finishing a frontend feature, or
  whenever the user asks to review/check frontend work, UI, styling, components,
  hooks, or "kuralları kontrol et". Triggers on: "frontend incele", "PR öncesi
  kontrol", "PR'a hazır mı", "UI review", "tasarım/stil kurallarına uyuyor mu",
  "bu component kurallara uygun mu", finishing a web feature branch. Prefer this
  over generic /code-review when the goal is conformance to PazarSync's documented
  frontend/UI/UX conventions rather than general bug hunting.
---

# Frontend PR Review (PazarSync)

A pre-PR gate that checks **changed frontend code** against PazarSync's own
documented frontend and UI/UX rules, then reports violations by severity and
auto-fixes only the safe, unambiguous ones.

This skill complements `/code-review` (general bug/quality hunting). Its job is
narrower and sharper: **does this diff obey the rules we already wrote down?**

## Core principle: the rules are alive, this skill is a lens

The authoritative rules live in the repo and **change over time**:

- Root `CLAUDE.md` — shared standards (TypeScript discipline, no hard-coded
  values, error-handling contract, i18n, dynamic mapping, feature boundaries)
- `apps/web/CLAUDE.md` — the frontend law: React patterns, state hierarchy,
  typed API client, RFC 7807 error flow, Tailwind v4 token system, dark-mode +
  SSR safety, Next.js 16, the UI selection cascade, component architecture,
  performance, testing
- `apps/web/CLAUDE.md` "Security Notes" + `docs/SECURITY.md` — frontend security
- The user's design memories — design direction (restrained, no second
  aesthetic), no left-border accent, mobile-first mandatory, **no financial
  calculation on the frontend**, Turkish via i18n only

`references/rule-map.md` in this skill is a **checklist lens**, not the law. It
exists to direct attention to the rule _categories_ that are stable. When you
are unsure whether something is a violation, or a category in the lens looks
relevant, **open the authoritative source and read the current rule** — never
assume the frozen summary is complete or up to date. If a rule exists in
`CLAUDE.md` that the lens doesn't mention, it still applies.

## Workflow

### 1. Scope the diff

Run the bundled scanner to get the changed frontend files and the mechanical
candidate findings in one shot:

```bash
bash .claude/skills/frontend-pr-review/scripts/scan-frontend-diff.sh
```

It computes the changed `apps/web/src` files (committed-on-branch vs
`origin/main` merge-base **plus** staged and unstaged working-tree changes) and
greps them for the high-precision, mechanically-detectable rule violations.

If the scanner reports no changed frontend files, say so and stop — there is
nothing to review.

### 2. Treat scanner output as candidates, not verdicts

Each scanner hit is `RULE_ID  file:line  matched text`. Some rules are exact;
others are marked `(heuristic)` and produce false positives (e.g. a hex color
inside a token CSS file is legitimate; `new Date()` is fine outside the render
path). **Read the surrounding code before trusting any hit.** Discard false
positives silently — do not report them.

### 3. Judgment pass — read the changed files

The scanner cannot see the rules that need understanding: an unnecessary
`useEffect`, prop drilling, a missing query-key factory, a custom component that
should have reused a `patterns/` composite, a missing test for a new hook, a
missing `error.tsx` on a new route segment, frontend code doing a profit
calculation. Read each changed file and apply the lens in
`references/rule-map.md`, opening the authoritative `CLAUDE.md` section whenever
a category is in play and the exact rule matters.

Pay special attention to the **highest-value, hardest-to-grep** rules:

- **No financial calculation on the frontend** — the UI renders backend-computed
  values; it must not compute profit/VAT/commission/margin. Decimal arithmetic
  on money inside a component or feature is a 🔴 blocker.
- **Typed API client only** — no raw `fetch()` against the API; data fetching
  goes through `apiClient` + a feature hook with a query-key factory.
- **SSR / hydration safety** in `'use client'` files — no reading `theme`,
  `new Date()`, `Date.now()`, `Math.random()` in the render path; no nested
  interactive elements.
- **UI selection cascade** — patterns → ui → shadcn → custom. Forking a `ui/`
  primitive, or hand-rolling something a pattern/primitive already provides, is
  a violation.
- **Feature boundaries** — no `features/X` importing from `features/Y`, and no
  shared layer (`components/patterns/`, `components/`, `lib/`) importing from
  `features/`. When a symbol is needed by 2+ features it belongs in the shared
  layer, not inside one feature. The `CROSS_FEATURE_IMPORT` scanner hit is only
  a heuristic — **confirm a suspected `feature → feature` violation by running
  `pnpm audit:boundaries`**, which prints the authoritative verdict (this is the
  CI gate; running this one targeted audit to verify a finding is fine — it is
  not the same as folding `check:affected` into the review). Note the audit only sees
  `feature → feature` edges; a `patterns/ → features/` inversion is real but
  invisible to it, so catch that one by reading the imports.

### 4. Classify every finding by severity

See "Severity model" below. Each finding gets exactly one severity and a
concrete location.

### 5. Auto-fix only the unambiguous ones

Apply the narrow auto-fix policy below. After applying ANY fix, run the affected
package's typecheck to confirm you did not break the build:

```bash
pnpm --filter web typecheck
```

If a fix breaks typecheck, revert it and downgrade that finding to a reported
suggestion with the intended fix described. Never let an auto-fix leave the
branch in a worse state than you found it.

### 6. Produce the report (in Turkish)

The report is prose a human reads, so it is written in **clear Turkish**
(project language rule). Use code identifiers, `file:line`, and class names
inline for precision — but the explanation of _what_ and _why_ is a real Turkish
sentence, never a soup of symbols. Follow the template in "Report format".

## Severity model

Assign severity by **consequence**, not by how easy the rule is to state.

**🔴 Engelleyici (Blocker) — PR'a girmemeli.** Breaks a security, correctness, or
non-negotiable architectural invariant:

- Frontend computes a financial value (profit/VAT/commission/margin) instead of
  rendering a backend-computed one
- Raw `fetch()` against the API, bypassing the typed client (loses auth header
  - error parsing)
- Displaying/requesting store credentials back, or `console.log` of orders,
  customer PII, or credentials
- Hydration-unsafe `'use client'` pattern that ships broken markup
- New route segment that can throw but has no `error.tsx`
- Hard-coded secret/key; cross-feature import (`features/X` → `features/Y`)

**🟡 Uyarı (Warning) — merge'den önce düzeltilmeli.** Convention/token/quality
violation that erodes the system but does not break it:

- Arbitrary Tailwind values (`bg-[#..]`, `p-[13px]`), hard-coded hex/rgb,
  T3-era `max-w-(sm|md|lg|…)` names, alpha-shortcut overuse instead of a token
- Inline `style={{}}` without a `// runtime-dynamic:` justification
- Inline Turkish text instead of next-intl i18n
- Hand-rolled toast in a hook instead of the global `onError`
- Inline query keys / missing query-key factory / `useQuery` wrapping a raw fetch
- `useEffect` deriving state that belongs in render / `useMemo`
- Prop drilling 3+ levels instead of context
- New custom hook / form / interactive component without its required test
- `any`, `as` assertion, `@ts-ignore`, non-exhaustive union switch, missing
  explicit return type on an exported function
- Magic numbers / inline marketplace values; new page missing `metadata`; sync
  `params`/`searchParams` access (Next.js 16 wants `await`)
- Left-border accent on active nav/card; a new palette or second aesthetic;
  forking a `ui/` primitive

**🔵 Öneri (Suggestion) — iyileştirme fırsatı.** Polish, not a rule break:

- Config-driven mapping opportunity (copy-pasted cards), composition cleanups
- Preemptive `React.memo`; missing virtualization for >50-item lists; missing
  `next/image`; heavy lib not dynamically imported
- Touch target < 44px without `pointer-coarse` handling; mobile-responsive gaps
- File/naming convention drift (kebab-case, `use-` prefix)

When you are unsure between two tiers, pick the lower-severity one and say why —
over-flagging trains the user to ignore the report.

## Auto-fix policy

Auto-fix **only** when the correct replacement is unambiguous, local, single-
purpose, and needs no new i18n key or design token:

- `className` built by string concatenation → `cn(...)`
- Stray non-sensitive `console.log`/`console.debug` → remove
- Arbitrary value with an exact 1:1 token (`text-[14px]` → `text-sm`,
  `rounded-[8px]` → `rounded-md`) — only when the scale has an exact match
- T3-era `max-w-md` → the documented role token **only** when the role is
  unambiguous from context (a form container → `max-w-form`); otherwise report

**Never auto-fix** (report with a concrete suggested fix instead): anything that
creates i18n keys or tokens, restructures data fetching, touches security or
financial logic, changes component structure, or where the right replacement
depends on intent. When in doubt, report — don't edit.

After any edit, verify with `pnpm --filter web typecheck` (step 5).

## Report format

```
# Frontend PR İncelemesi — <branch adı>

İncelenen: <N> değişen dosya (apps/web)
Sonuç: <X> engelleyici · <Y> uyarı · <Z> öneri · <K> otomatik düzeltildi

## 🔴 Engelleyiciler
- `apps/web/src/.../dosya.tsx:42` — <kural>
  Sorun: <ne yanlış, tek cümle Türkçe>
  Neden önemli: <hangi davranışı/güvenliği/sözleşmeyi bozuyor>
  Öneri: <somut düzeltme>

## 🟡 Uyarılar
- `...:line` — <kural> — <sorun> → <önerilen düzeltme>

## 🔵 Öneriler
- `...:line` — <iyileştirme fırsatı>

## ✅ Otomatik düzeltilenler
- `...:line` — <ne değişti> (typecheck geçti)

---
Sonuç: <"PR'a hazır görünüyor" | "Önce N engelleyiciyi çöz"> ·
Hatırlatma: commit öncesi `pnpm check:affected` mekanik kapıyı ayrıca çalıştırır.
```

If there are zero findings, say so plainly and confirm the diff looks clean
against the documented rules — don't manufacture suggestions to fill the report.

## Notes

- This skill reviews **conventions and UI/UX rules**. It deliberately does NOT
  run `pnpm typecheck` / `eslint` / tests as a review step — those mechanical
  gates already run in `pnpm check:affected` and in CI. The only typecheck it runs is to verify
  its own auto-fixes.
- The report is in Turkish; code identifiers and class names stay verbatim.
- The skill is read-only except for the narrow auto-fixes — it never opens a PR,
  commits, or pushes on its own.
