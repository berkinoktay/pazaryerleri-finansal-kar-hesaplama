// Every `pattern` of the generated OpenAPI spec is a plain JSON-Schema regex. The spec
// generator writes a flagged Zod regex with its flag suffix (`[\p{L}\p{N}]/u`), a pattern no
// value matches, so a schema built on a flagged regex gives its spec `pattern` by hand.
// This test reads the committed spec and fails on any pattern that still ends in a flag,
// that does not compile, or that refuses a sample (`example`, `default`, `examples`) given
// on the same schema node.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

import { ListProductsQuerySchema } from '@/validators/product.validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.resolve(here, '../../../../packages/api-client/openapi.json');

// A regex flag suffix left on a pattern, for example `/u` or `/gi`.
const FLAG_SUFFIX_RE = /\/[a-z]+$/;

// JSON-Schema patterns are ECMA-262 regexes; the `u` flag is needed for `\p{...}` classes.
const PATTERN_FLAGS = 'u';

const spec: unknown = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));

interface SpecPattern {
  at: string;
  pattern: string;
  samples: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The string samples a schema node gives next to its `pattern`. */
function stringSamples(node: Record<string, unknown>): string[] {
  const samples: string[] = [];
  const { example, default: defaultValue, examples } = node;
  if (typeof example === 'string') samples.push(example);
  if (typeof defaultValue === 'string') samples.push(defaultValue);
  if (Array.isArray(examples)) {
    for (const entry of examples) {
      if (typeof entry === 'string') samples.push(entry);
    }
  }
  return samples;
}

/** Every object node of `node` with a string `pattern`, its JSON path and its samples. */
function collectPatterns(node: unknown, at: string, out: SpecPattern[]): SpecPattern[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectPatterns(child, `${at}[${String(index)}]`, out));
    return out;
  }
  if (!isRecord(node)) return out;
  const { pattern } = node;
  if (typeof pattern === 'string') out.push({ at, pattern, samples: stringSamples(node) });
  for (const [key, value] of Object.entries(node)) {
    collectPatterns(value, `${at}.${key}`, out);
  }
  return out;
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, PATTERN_FLAGS);
  } catch {
    return null;
  }
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

  it('holds only patterns that compile as unicode regular expressions', () => {
    const broken = patterns.filter(({ pattern }) => compilePattern(pattern) === null);

    expect(broken.map(({ at }) => at)).toEqual([]);
  });

  it('gives every example, default and examples entry a value its own pattern matches', () => {
    const sampleCount = patterns.reduce((sum, { samples }) => sum + samples.length, 0);
    const refused = patterns.flatMap(({ at, pattern, samples }) => {
      // A pattern that does not compile is reported by the test above.
      const regex = compilePattern(pattern);
      if (regex === null) return [];
      return samples
        .filter((sample) => !regex.test(sample))
        .map((sample) => ({ at, pattern, sample }));
    });

    expect(sampleCount).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });

  it('gives the organization name its letter-or-digit pattern, which its example passes', () => {
    const name =
      OrganizationNameSpecSchema.parse(spec).components.schemas.CreateOrganizationInput.properties
        .name;

    expect(name.pattern).toBe('[\\p{L}\\p{N}]');
    expect(new RegExp(name.pattern, 'u').test(name.example)).toBe(true);
  });
});

// The products list ids keep their runtime parsing; only their spec `pattern` is given by hand.
describe('products list query bigint ids', () => {
  const BIGINT_ID_FIELDS = ['brandId', 'categoryId'] as const;

  it.each(BIGINT_ID_FIELDS)('parses a digit string %s to a bigint', (field) => {
    const parsed = ListProductsQuerySchema.parse({ [field]: '2032' });

    expect(parsed[field]).toBe(2032n);
  });

  it.each(BIGINT_ID_FIELDS)('refuses a non-digit %s on that field', (field) => {
    const result = ListProductsQuerySchema.safeParse({ [field]: 'abc' });

    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path);
    expect(paths).toEqual([[field]]);
  });
});
