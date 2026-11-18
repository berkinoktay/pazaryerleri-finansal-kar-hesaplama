// Every `pattern` of the generated OpenAPI spec is a plain JSON-Schema regex. The spec
// generator writes a flagged Zod regex with its flag suffix (`[\p{L}\p{N}]/u`), a pattern no
// value matches, so a schema built on a flagged regex gives its spec `pattern` by hand.
// This test reads the committed spec and fails on any pattern that still ends in a flag.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.resolve(here, '../../../../packages/api-client/openapi.json');

// A regex flag suffix left on a pattern, for example `/u` or `/gi`.
const FLAG_SUFFIX_RE = /\/[a-z]+$/;

const spec: unknown = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));

interface SpecPattern {
  at: string;
  pattern: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every string under a `pattern` key of `node`, with the JSON path it was found at. */
function collectPatterns(node: unknown, at: string, out: SpecPattern[]): SpecPattern[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectPatterns(child, `${at}[${String(index)}]`, out));
    return out;
  }
  if (!isRecord(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    const childAt = `${at}.${key}`;
    if (key === 'pattern' && typeof value === 'string') out.push({ at: childAt, pattern: value });
    collectPatterns(value, childAt, out);
  }
  return out;
}

const OrganizationNameSpecSchema = z.object({
  components: z.object({
    schemas: z.object({
      CreateOrganizationInput: z.object({
        properties: z.object({
          name: z.object({ pattern: z.string(), example: z.string() }),
        }),
      }),
    }),
  }),
});

describe('OpenAPI spec patterns', () => {
  const patterns = collectPatterns(spec, '$', []);

  it('finds the patterns of the spec', () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('holds no pattern that ends in a regex flag suffix', () => {
    const flagged = patterns.filter(({ pattern }) => FLAG_SUFFIX_RE.test(pattern));

    expect(flagged).toEqual([]);
  });

  it('gives the organization name its letter-or-digit pattern, which its example passes', () => {
    const name =
      OrganizationNameSpecSchema.parse(spec).components.schemas.CreateOrganizationInput.properties
        .name;

    expect(name.pattern).toBe('[\\p{L}\\p{N}]');
    expect(new RegExp(name.pattern, 'u').test(name.example)).toBe(true);
  });
});
