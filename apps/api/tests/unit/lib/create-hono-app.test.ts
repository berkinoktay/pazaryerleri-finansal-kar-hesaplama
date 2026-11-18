// The shared Zod default hook every route sub-app gets from createSubApp(): each Zod issue
// becomes one `errors[]` entry whose `code` is a machine code. A rule that sets its own
// SCREAMING_SNAKE_CASE message keeps it; a rule without one (Zod's own sentence) answers
// INVALID_FIELD, so a library sentence never reaches the wire. `meta` keeps the Zod issue
// code and the issue params.

import { createRoute, z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

import { createSubApp, INVALID_FIELD } from '@/lib/create-hono-app';
import { ValidationError } from '@/lib/errors';

const FIELD_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
const LOWER_CASE_OR_SPACE_RE = /[a-z ]/;

const TAGGED_ITEM_ID = 'item-1';

const ProbeBodySchema = z.object({
  coded: z.string().min(2, 'TOO_SHORT_CODE'),
  id: z.string().uuid(),
  choice: z.enum(['a', 'b']),
  tagged: z.string().superRefine((_value, ctx) => {
    ctx.addIssue({ code: 'custom', message: 'TAGGED_CODE', params: { itemId: TAGGED_ITEM_ID } });
  }),
  sentence: z.string().superRefine((_value, ctx) => {
    ctx.addIssue({ code: 'custom', message: 'not a code', params: { itemId: TAGGED_ITEM_ID } });
  }),
});

const probeRoute = createRoute({
  method: 'post',
  path: '/probe',
  request: {
    body: { content: { 'application/json': { schema: ProbeBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: 'Accepted',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
  },
});

const IssuesBodySchema = z.object({
  issues: z.array(
    z.object({
      field: z.string(),
      code: z.string(),
      meta: z.record(z.string(), z.unknown()),
    }),
  ),
});

type WireIssue = z.infer<typeof IssuesBodySchema>['issues'][number];

function buildProbeApp(): ReturnType<typeof createSubApp> {
  const app = createSubApp();
  app.openapi(probeRoute, (c) => c.json({ ok: true }, 200));
  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ issues: err.issues }, 422);
    return c.json({ unexpected: String(err) }, 500);
  });
  return app;
}

async function postProbe(body: unknown): Promise<Response> {
  return buildProbeApp().request('/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function wireIssues(body: unknown): Promise<WireIssue[]> {
  const res = await postProbe(body);
  expect(res.status).toBe(422);
  return IssuesBodySchema.parse(await res.json()).issues;
}

function issueOf(issues: WireIssue[], field: string): WireIssue | undefined {
  return issues.find((issue) => issue.field === field);
}

const INVALID_BODY = {
  coded: 'x',
  id: 'not-a-uuid',
  choice: 'c',
  tagged: 'anything',
  sentence: 'anything',
};

describe('validationDefaultHook (createSubApp)', () => {
  it('holds its backstop code', () => {
    expect(INVALID_FIELD).toBe('INVALID_FIELD');
    expect(INVALID_FIELD).toMatch(FIELD_CODE_RE);
  });

  it('keeps the code of a rule that sets one', async () => {
    const issues = await wireIssues(INVALID_BODY);

    expect(issueOf(issues, 'coded')).toEqual({
      field: 'coded',
      code: 'TOO_SHORT_CODE',
      meta: { zodCode: 'too_small' },
    });
  });

  it.each([
    ['a .uuid() rule', 'id', 'invalid_format'],
    ['a z.enum rule', 'choice', 'invalid_value'],
  ])('answers INVALID_FIELD for %s without a code', async (_name, field, zodCode) => {
    const issues = await wireIssues(INVALID_BODY);

    expect(issueOf(issues, field)).toEqual({ field, code: INVALID_FIELD, meta: { zodCode } });
  });

  it('merges the issue params into meta beside zodCode', async () => {
    const issues = await wireIssues(INVALID_BODY);

    expect(issueOf(issues, 'tagged')).toEqual({
      field: 'tagged',
      code: 'TAGGED_CODE',
      meta: { zodCode: 'custom', itemId: TAGGED_ITEM_ID },
    });
    expect(issueOf(issues, 'sentence')).toEqual({
      field: 'sentence',
      code: INVALID_FIELD,
      meta: { zodCode: 'custom', itemId: TAGGED_ITEM_ID },
    });
  });

  it('puts only machine codes on the wire', async () => {
    const issues = await wireIssues(INVALID_BODY);

    expect(issues).toHaveLength(Object.keys(INVALID_BODY).length);
    for (const issue of issues) {
      expect(issue.code).toMatch(FIELD_CODE_RE);
      expect(issue.code).not.toMatch(LOWER_CASE_OR_SPACE_RE);
    }
  });
});
