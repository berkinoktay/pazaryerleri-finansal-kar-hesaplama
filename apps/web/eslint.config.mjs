import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * PazarSync frontend ESLint config.
 *
 * Beyond the Next.js defaults, this enforces the design-system contract:
 *   1. No arbitrary Tailwind values in product code. Every magic px, hex,
 *      or raw oklch() reference must live in the token layer, not in
 *      component className strings.
 *   2. No raw `max-w-(xs|sm|md|...|7xl)` utilities. In Tailwind v4, those
 *      names collide with our `--space-*` scale (so `max-w-md` renders as
 *      16px, not 28rem). Use domain tokens instead: `max-w-form`,
 *      `max-w-modal`, `max-w-sheet`, `max-w-headline`, `max-w-input`,
 *      `max-w-input-narrow`, `max-w-content-max`, `max-w-prose-max`.
 *      See `src/app/tokens/spacing.css` for the full list.
 *
 * Exempted paths:
 *   - `src/components/ui/**` — shadcn primitives have some computed
 *     values (grid templates, Radix state selectors) that read arbitrary
 *     but are structural, not decorative.
 *   - `src/app/(showcase)/**` — the design-system showcase iterates
 *     tokens and renders some tokens via inline `var(--x)` styles; those
 *     exceptions are already comment-annotated (`runtime-dynamic: ...`).
 */

// Rule 1: bracketed arbitrary values with px/rem/em/%/hex/oklch/rgb
const ARBITRARY_VALUE_SELECTOR =
  "Literal[value=/\\[(?:[^\\]]*?)(?:\\d+(?:px|rem|em|%)|#[0-9a-fA-F]{3,8}|oklch\\(|rgb\\()[^\\]]*\\]/]";

// Rule 2: Tailwind container-scale utilities that collide with spacing scale.
// Catches standalone (`max-w-md`) and responsive (`sm:max-w-md`) forms.
const COLLIDING_MAXW_LITERAL =
  "Literal[value=/(?:^|\\s|:)max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)(?:\\s|$)/]";
const COLLIDING_MAXW_TEMPLATE =
  "TemplateElement[value.raw=/(?:^|\\s|:)max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)(?:\\s|$)/]";

const COLLIDING_MAXW_MESSAGE =
  'Do not use `max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)` — these collide with the --space-* scale in Tailwind v4 and render as a few pixels. Use a domain token: max-w-form (448px), max-w-modal (512px), max-w-sheet (384px), max-w-sheet-wide (448px), max-w-input (384px), max-w-input-narrow (320px), max-w-headline (896px), max-w-content-max (1440px), max-w-prose-max (68ch). Add a new one to src/app/tokens/spacing.css if you need a different size.';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/app/(showcase)/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name='className'] ${ARBITRARY_VALUE_SELECTOR}`,
          message:
            "Arbitrary Tailwind values are banned. Add the value to the token system (src/app/tokens/*.css) and consume via a named utility (e.g. 'w-md', 'rounded-lg', 'h-shell-demo').",
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateLiteral > TemplateElement[value.raw=/\\[(?:[^\\]]*?)(?:\\d+(?:px|rem|em|%)|#[0-9a-fA-F]{3,8}|oklch\\(|rgb\\()[^\\]]*\\]/]`,
          message:
            'Arbitrary Tailwind values are banned in template literals too. Use a token utility.',
        },
        {
          selector: `JSXAttribute[name.name='className'] ${COLLIDING_MAXW_LITERAL}`,
          message: COLLIDING_MAXW_MESSAGE,
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateLiteral > ${COLLIDING_MAXW_TEMPLATE}`,
          message: COLLIDING_MAXW_MESSAGE,
        },
      ],
    },
  },
  // React Compiler rules don't apply to shadcn-generated primitives.
  // shadcn ships canonical patterns (e.g. Math.random in skeleton width,
  // sync setState in viewport hook effects) we are not meant to touch —
  // see UI-development workflow rules in apps/web/CLAUDE.md.
  // The hooks/ folder is the shadcn-canonical location for `use-mobile`.
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/hooks/use-mobile.{ts,tsx}'],
    rules: {
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
