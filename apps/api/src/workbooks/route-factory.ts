// Builds a page's workbook import and export routes from its adapter. Each route is its
// own sub-app, mounted where the page's legacy route was, so the OpenAPI document lists
// the paths in the same order.

import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';

import type { LayoutSpec } from '@pazarsync/spreadsheet';

import { createSubApp } from '../lib/create-hono-app';
import {
  requireStoreAccessContext,
  WORKBOOK_EXPORT_MIDDLEWARE,
  WORKBOOK_IMPORT_MIDDLEWARE,
  type StoreAccessVariables,
} from '../middleware/workbook-upload.middleware';
import {
  Common429Response,
  ProblemDetailsSchema,
  RateLimitHeaders,
  WORKBOOK_EXPORT_ERROR_RESPONSES,
  WORKBOOK_IMPORT_ERROR_RESPONSES,
} from '../openapi';
import type { WorkbookExportAdapter, WorkbookImportAdapter } from './adapter';
import { downloadHeaders } from './download';
import { exportWorkbook } from './export-workbook';
import { importWorkbook } from './import-workbook';
import { WorkbookInvariantError } from './workbook-errors';

// The rule `storeAccessMiddleware` applies to the raw path ids.
const StorePathIdsSchema = z.object({ orgId: z.string().uuid(), storeId: z.string().uuid() });

/**
 * `POST /organizations/{orgId}/stores/{storeId}/<segment>/import`: the upload guard
 * chain, the page's form, then the generic import. The path ids only select the store
 * access record the middleware verified; the import runs with that record's ids and
 * platform.
 */
export function createWorkbookImportRoute<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TResponse,
  TWrite extends string,
>(
  adapter: WorkbookImportAdapter<S, TRow, TConfig, TMeta, TResponse, TWrite>,
): OpenAPIHono<{ Variables: StoreAccessVariables }> {
  const app = createSubApp<{ Variables: StoreAccessVariables }>();
  const { http } = adapter;

  const route = createRoute({
    method: 'post',
    path: `/organizations/{orgId}/stores/{storeId}/${http.segment}/import`,
    tags: [http.tag],
    summary: http.importSummary,
    description: http.importDescription,
    security: [{ bearerAuth: [] }],
    middleware: WORKBOOK_IMPORT_MIDDLEWARE,
    request: {
      params: http.storePathSchema,
      body: {
        content: { 'multipart/form-data': { schema: adapter.formSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: adapter.responseSchema } },
        description: http.importCreated,
        headers: RateLimitHeaders,
      },
      401: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: 'Missing or invalid auth token',
      },
      403: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: 'Insufficient role to modify store data',
      },
      404: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: 'Store not found or belongs to a different organization',
      },
      409: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description:
          "Another import of this page is running, or the store's upload quota is reached",
      },
      422: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: http.import422,
      },
      ...WORKBOOK_IMPORT_ERROR_RESPONSES,
      429: Common429Response,
    },
  });

  app.openapi(route, async (c) => {
    const { orgId, storeId } = StorePathIdsSchema.parse(c.req.param());
    const { store } = requireStoreAccessContext(c, orgId, storeId);
    const form = adapter.readForm(c.req.valid('form'));
    const response: TResponse = await importWorkbook(adapter, {
      organizationId: store.organizationId,
      storeId: store.id,
      platform: store.platform,
      file: Buffer.from(await form.file.arrayBuffer()),
      filename: form.file.name,
      createdBy: c.get('userId'),
      name: form.name,
      config: form.config,
      now: new Date(),
    });
    return c.json(response, 201);
  });

  return app;
}

/**
 * `POST /organizations/{orgId}/stores/{storeId}/<segment>/{<idParam>}/export`: the rate
 * limit and store access, then the generic export of the record. The path's org and
 * store ids only select the store access record the middleware verified; the export
 * runs with that record's ids and platform, and the record id is the validated path
 * parameter.
 */
export function createWorkbookExportRoute<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  adapter: WorkbookExportAdapter<S, TRow, TItem, TWrite>,
): OpenAPIHono<{ Variables: StoreAccessVariables }> {
  const app = createSubApp<{ Variables: StoreAccessVariables }>();
  const { http } = adapter;
  const binary = z.string().openapi({ type: 'string', format: 'binary' });

  const route = createRoute({
    method: 'post',
    path: `/organizations/{orgId}/stores/{storeId}/${http.segment}/{${http.idParam}}/export`,
    tags: [http.tag],
    summary: http.exportSummary,
    description: http.exportDescription,
    security: [{ bearerAuth: [] }],
    middleware: WORKBOOK_EXPORT_MIDDLEWARE,
    request: { params: http.itemPathSchema },
    responses: {
      200: {
        content: Object.fromEntries(http.exportMimes.map((mime) => [mime, { schema: binary }])),
        description: http.exportOk,
      },
      401: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: 'Missing or invalid auth token',
      },
      403: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: 'Insufficient role to modify store data',
      },
      404: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: http.export404,
      },
      409: {
        content: { 'application/json': { schema: ProblemDetailsSchema } },
        description: http.export409,
      },
      ...WORKBOOK_EXPORT_ERROR_RESPONSES,
      429: Common429Response,
    },
  });

  app.openapi(route, async (c) => {
    const { orgId, storeId } = StorePathIdsSchema.parse(c.req.param());
    const { store } = requireStoreAccessContext(c, orgId, storeId);
    const recordId: unknown = c.req.valid('param')[http.idParam];
    if (typeof recordId !== 'string') {
      throw new WorkbookInvariantError(`The ${http.idParam} path parameter was not validated`);
    }
    const bundle = await exportWorkbook(
      adapter,
      { organizationId: store.organizationId, storeId: store.id },
      recordId,
      store.platform,
    );
    return c.body(new Uint8Array(bundle.body), 200, downloadHeaders(bundle));
  });

  return app;
}
