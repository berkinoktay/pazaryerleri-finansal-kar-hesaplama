// Compile the Tailwind v4 stylesheet for the design-sync bundle.
// Run from apps/web: cd apps/web && node .design-sync-build/compile-css.mjs
// pnpm keeps postcss in the hoisted .pnpm store (not a direct dep of
// @pazarsync/web), so we resolve postcss THROUGH the @tailwindcss/postcss
// package location rather than relying on a top-level node_modules entry.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pluginPath = require.resolve('@tailwindcss/postcss', { paths: [resolve('node_modules')] });
const fromPlugin = createRequire(pluginPath);
const postcss = fromPlugin('postcss');
const tw = require(pluginPath);
const tailwindcss = tw.default ?? tw;

const entry = resolve('.design-sync-build/tw-entry.css');
const out = resolve('.design-sync-build/compiled.css');

const css = readFileSync(entry, 'utf8');
const result = await postcss([tailwindcss()]).process(css, { from: entry, to: out });
writeFileSync(out, result.css);
console.log(`compiled ${(result.css.length / 1024).toFixed(0)} KB → ${out}`);
