// Pre-body upload guard on the six campaign import routes, and the export rate limit.
//
// @hono/zod-openapi's form validator buffers the whole multipart body before the
// handler runs, so the guard lives in route middleware that runs BEFORE it, in this
// order: rate limit -> store access + capability -> content type -> body size. These
// cases pin that order from the outside:
//   - a non-member's oversized body is refused with 403, not 413: access ran first and
//     the body was never read;
//   - a non-multipart body is refused with 415 before any form parsing, and a chunked
//     oversized one with 415, not 413: the header check ran before the body limit
//     buffered anything;
//   - an owner's oversized body is refused with 413 whether the size is declared in
//     Content-Length or only discovered while streaming a chunked body.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildXlsxFixture, worksheetXml } from '@pazarsync/spreadsheet/testing';
import { WORKBOOK_UPLOAD_MAX_BYTES } from '@pazarsync/utils';

import { createApp } from '@/app';
import { RATE_LIMITS } from '@/config/rate-limits';
import { MULTIPART_OVERHEAD_BYTES } from '@/config/workbook-limits';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

const app = createApp();

const IMPORT_RESOURCES = [
  'commission-tariffs',
  'plus-commission-tariffs',
  'advantage-tariffs',
  'flash-products',
  'discount-lists',
  'marketplace-campaigns',
] as const;

type ImportResource = (typeof IMPORT_RESOURCES)[number];

const BOUNDARY = 'workbook-upload-guard-boundary';
const MULTIPART_CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;
// One byte past the request-body limit the guard enforces.
const OVERSIZE_BODY_BYTES = WORKBOOK_UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD_BYTES + 1;
const STREAM_CHUNK_BYTES = 64 * 1024;
// The hostile <dimension> file once took the API down with an out-of-memory grid build;
// the engine must now reject it as a normal validation failure, quickly.
// Loose for parallel CI runs but below the default 5 s test timeout; the original failure
// was a process crash, not a slow answer.
const DIMENSION_FILE_BUDGET_MS = 4_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A well-formed multipart body of exactly OVERSIZE_BODY_BYTES: one `file` part whose
 * content is zero bytes filling the space between the part header and the closing
 * boundary. Built once; request bodies only read from it.
 */
function buildOversizeMultipartBody(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="oversize.xlsx"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n',
  );
  const tail = encoder.encode(`\r\n--${BOUNDARY}--\r\n`);
  const body = new Uint8Array(OVERSIZE_BODY_BYTES);
  body.set(head, 0);
  body.set(tail, OVERSIZE_BODY_BYTES - tail.length);
  return body;
}

const OVERSIZE_BODY = buildOversizeMultipartBody();

// 'x' as a byte: the filler of the oversized JSON string value.
const FILLER_BYTE = 0x78;

/** A well-formed JSON object of exactly OVERSIZE_BODY_BYTES: one long string field. */
function buildOversizeJsonBody(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const head = encoder.encode('{"name":"');
  const tail = encoder.encode('"}');
  const body = new Uint8Array(OVERSIZE_BODY_BYTES).fill(FILLER_BYTE);
  body.set(head, 0);
  body.set(tail, OVERSIZE_BODY_BYTES - tail.length);
  return body;
}

const OVERSIZE_JSON_BODY = buildOversizeJsonBody();

/** Streams `bytes` in fixed chunks, so the request carries no Content-Length. */
function chunkedStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  let offset = 0;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + STREAM_CHUNK_BYTES));
      offset += STREAM_CHUNK_BYTES;
    },
  });
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

function importUrl(orgId: string, storeId: string, resource: ImportResource): string {
  return `http://local/v1/organizations/${orgId}/stores/${storeId}/${resource}/import`;
}

function oversizeRequest(url: string, token: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      Authorization: bearer(token),
      'Content-Type': MULTIPART_CONTENT_TYPE,
      'Content-Length': String(OVERSIZE_BODY.length),
    },
    body: OVERSIZE_BODY,
  });
}

/**
 * Node's fetch requires `duplex: 'half'` for a stream body, but the DOM
 * `RequestInit` typing the app compiles against does not declare it.
 */
interface StreamingRequestInit extends RequestInit {
  duplex: 'half';
}

function chunkedRequest(
  url: string,
  token: string,
  contentType: string,
  bytes: Uint8Array<ArrayBuffer>,
): Request {
  const init: StreamingRequestInit = {
    method: 'POST',
    headers: { Authorization: bearer(token), 'Content-Type': contentType },
    body: chunkedStream(bytes),
    duplex: 'half',
  };
  return new Request(url, init);
}

function chunkedOversizeRequest(url: string, token: string): Request {
  return chunkedRequest(url, token, MULTIPART_CONTENT_TYPE, OVERSIZE_BODY);
}

function jsonRequest(url: string, token: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { Authorization: bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'not-a-file' }),
  });
}

function formRequest(url: string, token: string, fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'tiny.xlsx');
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(url, {
    method: 'POST',
    headers: { Authorization: bearer(token) },
    body: form,
  });
}

async function problemCode(res: Response): Promise<unknown> {
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || !('code' in body)) return undefined;
  return body.code;
}

async function setupOwnerStore(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

describe('workbook upload guard on the import routes', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    _resetRateLimitStoreForTests();
    ctx = await setupOwnerStore();
  });

  it.each(IMPORT_RESOURCES)(
    '%s: oversize body from an owner -> 413 PAYLOAD_TOO_LARGE',
    async (resource) => {
      const res = await app.request(
        oversizeRequest(importUrl(ctx.orgId, ctx.storeId, resource), ctx.accessToken),
      );

      expect(res.status).toBe(413);
      expect(await problemCode(res)).toBe('PAYLOAD_TOO_LARGE');
    },
  );

  it.each(IMPORT_RESOURCES)(
    '%s: oversize body from a non-member -> 403 (access runs before the body)',
    async (resource) => {
      const outsider = await createAuthenticatedTestUser();

      const res = await app.request(
        oversizeRequest(importUrl(ctx.orgId, ctx.storeId, resource), outsider.accessToken),
      );

      expect(res.status).toBe(403);
      expect(await problemCode(res)).toBe('FORBIDDEN');
    },
  );

  it.each(IMPORT_RESOURCES)(
    '%s: chunked oversize body without Content-Length -> 413',
    async (resource) => {
      const res = await app.request(
        chunkedOversizeRequest(importUrl(ctx.orgId, ctx.storeId, resource), ctx.accessToken),
      );

      expect(res.status).toBe(413);
      expect(await problemCode(res)).toBe('PAYLOAD_TOO_LARGE');
    },
  );

  it.each(IMPORT_RESOURCES)('%s: JSON body -> 415 UNSUPPORTED_MEDIA_TYPE', async (resource) => {
    const res = await app.request(
      jsonRequest(importUrl(ctx.orgId, ctx.storeId, resource), ctx.accessToken),
    );

    expect(res.status).toBe(415);
    expect(await problemCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it.each(IMPORT_RESOURCES)(
    '%s: chunked oversize JSON body without Content-Length -> 415, not 413',
    async (resource) => {
      const res = await app.request(
        chunkedRequest(
          importUrl(ctx.orgId, ctx.storeId, resource),
          ctx.accessToken,
          'application/json',
          OVERSIZE_JSON_BODY,
        ),
      );

      expect(res.status).toBe(415);
      expect(await problemCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE');
    },
  );

  it.each(IMPORT_RESOURCES)('%s: VIEWER with store access -> 403', async (resource) => {
    const viewer = await createAuthenticatedTestUser();
    const member = await createMembership(ctx.orgId, viewer.id, 'VIEWER');
    await createMemberStoreAccess(ctx.orgId, member.id, ctx.storeId);

    const res = await app.request(
      formRequest(importUrl(ctx.orgId, ctx.storeId, resource), viewer.accessToken),
    );

    expect(res.status).toBe(403);
    expect(await problemCode(res)).toBe('FORBIDDEN');
  });

  it.each(IMPORT_RESOURCES)('%s: non-UUID orgId -> 422 VALIDATION_ERROR', async (resource) => {
    const res = await app.request(
      formRequest(importUrl('not-a-uuid', ctx.storeId, resource), ctx.accessToken),
    );

    expect(res.status).toBe(422);
    expect(await problemCode(res)).toBe('VALIDATION_ERROR');
  });

  it.each(IMPORT_RESOURCES)(
    '%s: the import beyond the per-minute limit -> 429',
    async (resource) => {
      const url = importUrl(ctx.orgId, ctx.storeId, resource);
      // Cheap requests that still count: each passes the limiter and the access check,
      // then stops at the content-type check.
      for (let i = 0; i < RATE_LIMITS.FILE_IMPORT.max; i += 1) {
        const allowed = await app.request(jsonRequest(url, ctx.accessToken));
        expect(allowed.status).toBe(415);
      }

      const res = await app.request(jsonRequest(url, ctx.accessToken));

      expect(res.status).toBe(429);
      expect(await problemCode(res)).toBe('RATE_LIMITED');
    },
  );

  it('discount-lists: the hostile dimension file returns 422 promptly', async () => {
    const file = buildXlsxFixture([
      {
        name: 'Ürünler',
        xml: worksheetXml([['Barkod'], ['X1']], { dimension: 'A1:ZZ300000' }),
      },
    ]);
    const now = Date.now();
    const config = {
      discountType: 'NET',
      valueKind: 'AMOUNT',
      value: '50',
      startsAt: new Date(now + MS_PER_DAY).toISOString(),
      endsAt: new Date(now + 2 * MS_PER_DAY).toISOString(),
    };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), 'dimension.xlsx');
    for (const [key, value] of Object.entries(config)) form.append(key, value);
    const request = new Request(importUrl(ctx.orgId, ctx.storeId, 'discount-lists'), {
      method: 'POST',
      headers: { Authorization: bearer(ctx.accessToken) },
      body: form,
    });

    const startedAt = performance.now();
    const res = await app.request(request);
    const elapsedMs = performance.now() - startedAt;

    expect(res.status).toBe(422);
    expect(await problemCode(res)).toBe('VALIDATION_ERROR');
    expect(elapsedMs).toBeLessThan(DIMENSION_FILE_BUDGET_MS);
  });
});

describe('rate limit on the export routes', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    _resetRateLimitStoreForTests();
  });

  it('discount-lists: the export beyond the per-minute limit -> 429', async () => {
    const ctx = await setupOwnerStore();
    const url =
      `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}` +
      `/discount-lists/${crypto.randomUUID()}/export`;
    const exportRequest = (): Request =>
      new Request(url, { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) } });

    // Cheap requests that still count: the list does not exist, so each one is a 404.
    for (let i = 0; i < RATE_LIMITS.FILE_EXPORT.max; i += 1) {
      const allowed = await app.request(exportRequest());
      expect(allowed.status).toBe(404);
    }

    const res = await app.request(exportRequest());

    expect(res.status).toBe(429);
    expect(await problemCode(res)).toBe('RATE_LIMITED');
  });
});
