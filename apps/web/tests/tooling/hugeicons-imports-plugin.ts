// Vitest-only Vite plugin: load each hugeicons-react icon on its own.
//
// `hugeicons-react` is a barrel that re-exports 4 600+ wrapper modules, and every
// wrapper imports its SVG data from the `@hugeicons/core-free-icons` barrel
// (another 4 600+ modules). Vitest isolates every test file in a fresh process,
// so any test that renders a component with an icon re-loaded both barrels —
// ~1.8 s per file on an idle laptop, two thirds of the CI component job.
// Next.js avoids this with `optimizePackageImports: ['hugeicons-react']`; Vitest
// does not read that setting, hence this plugin.
//
// It rewrites `import { XIcon } from 'hugeicons-react'` into one import per icon
// from a virtual module that wires the single core icon file into the same
// `HugeiconsIcon` component the published wrapper uses. Production code and
// the Next.js build are untouched.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin } from 'vitest/config';

const SOURCE_PACKAGE = 'hugeicons-react';
const VIRTUAL_PREFIX = 'virtual:hugeicon/';
const RESOLVED_VIRTUAL_PREFIX = `\0${VIRTUAL_PREFIX}`;
const ICON_NAME_RE = /^[A-Z][A-Za-z0-9]*Icon$/;
// Anchored to the start of a line (esbuild emits every import statement there),
// so the same text inside a string literal or an expression is never touched.
const IMPORT_STATEMENT_RE =
  /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])hugeicons-react\2[ \t]*;?/gm;
const ALIAS_SEPARATOR_RE = /\s+as\s+/;
// dist/{cjs,esm}/index.js → package root.
const ENTRY_DEPTH_BELOW_PACKAGE_ROOT = 3;

interface IconSpecifier {
  imported: string;
  local: string;
}

function parseSpecifiers(list: string): IconSpecifier[] | null {
  const specifiers: IconSpecifier[] = [];
  for (const raw of list.split(',')) {
    const part = raw.trim();
    if (part === '') continue;
    const [imported, local, ...rest] = part.split(ALIAS_SEPARATOR_RE);
    if (imported === undefined || rest.length > 0 || !ICON_NAME_RE.test(imported)) return null;
    specifiers.push({ imported, local: local ?? imported });
  }
  return specifiers.length > 0 ? specifiers : null;
}

function renderImport({ imported, local }: IconSpecifier): string {
  const binding = imported === local ? imported : `${imported} as ${local}`;
  return `import { ${binding} } from '${VIRTUAL_PREFIX}${imported}';`;
}

/**
 * Rewrites every `import { … } from 'hugeicons-react'` statement in `code` into
 * one import per icon from `virtual:hugeicon/<Name>`. The replacement keeps the
 * statement's line count so stack-trace line numbers stay correct. A statement
 * with any specifier that is not an icon component is left as it is (correct,
 * just not faster). Returns null when nothing was rewritten.
 */
export function rewriteHugeiconsImports(code: string): string | null {
  if (!code.includes(SOURCE_PACKAGE)) return null;
  let rewritten = false;
  const next = code.replace(IMPORT_STATEMENT_RE, (statement: string, list: string) => {
    const specifiers = parseSpecifiers(list);
    if (specifiers === null) return statement;
    rewritten = true;
    const lineBreaks = statement.split('\n').length - 1;
    return specifiers.map(renderImport).join(' ') + '\n'.repeat(lineBreaks);
  });
  return rewritten ? next : null;
}

function packageRootOf(entryFile: string): string {
  let dir = entryFile;
  for (let i = 0; i < ENTRY_DEPTH_BELOW_PACKAGE_ROOT; i++) dir = path.dirname(dir);
  return dir;
}

interface IconSources {
  hugeiconsReactEsm: string;
  coreIconsEsmDir: string;
}

// pnpm is strict: apps/web depends on hugeicons-react only, so its own
// dependencies are resolved from hugeicons-react's location.
function locateIconSources(): IconSources {
  const fromWeb = createRequire(import.meta.url);
  const fromWrapper = createRequire(fromWeb.resolve(SOURCE_PACKAGE));
  const hugeiconsReactEsm = path.join(
    packageRootOf(fromWrapper.resolve('@hugeicons/react')),
    'dist/esm/index.js',
  );
  const coreIconsEsmDir = path.join(
    packageRootOf(fromWrapper.resolve('@hugeicons/core-free-icons')),
    'dist/esm',
  );
  for (const required of [hugeiconsReactEsm, coreIconsEsmDir]) {
    if (!fs.existsSync(required)) {
      throw new Error(
        `hugeicons test plugin: expected ${required} — the package layout changed; update tests/tooling/hugeicons-imports-plugin.ts`,
      );
    }
  }
  return { hugeiconsReactEsm, coreIconsEsmDir };
}

function renderIconModule(name: string, sources: IconSources): string {
  if (!ICON_NAME_RE.test(name)) {
    throw new Error(`hugeicons test plugin: "${name}" is not an icon export name`);
  }
  const iconFile = path.join(sources.coreIconsEsmDir, `${name}.js`);
  if (!fs.existsSync(iconFile)) {
    throw new Error(`hugeicons test plugin: hugeicons-react has no icon named "${name}"`);
  }
  return [
    `import { createElement } from 'react';`,
    `import { HugeiconsIcon } from ${JSON.stringify(sources.hugeiconsReactEsm)};`,
    `import icon from ${JSON.stringify(iconFile)};`,
    `export const ${name} = (props) => createElement(HugeiconsIcon, { icon, ...props });`,
    `${name}.displayName = ${JSON.stringify(name)};`,
  ].join('\n');
}

export function hugeiconsImportsPlugin(): Plugin {
  const sources = locateIconSources();
  return {
    name: 'pazarsync:hugeicons-test-imports',
    transform(code, id) {
      if (id.includes('/node_modules/')) return null;
      const next = rewriteHugeiconsImports(code);
      return next === null ? null : { code: next, map: null };
    },
    resolveId(id) {
      return id.startsWith(VIRTUAL_PREFIX) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED_VIRTUAL_PREFIX)) return null;
      return renderIconModule(id.slice(RESOLVED_VIRTUAL_PREFIX.length), sources);
    },
  };
}
