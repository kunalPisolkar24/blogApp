import { ApolloServer, HeaderMap } from '@apollo/server';
import type { MiddlewareHandler } from 'hono';
import { createContext } from '../context.js';
import { PayloadTooLargeError, ValidationError } from '../errors.js';
import { hasErrors, operationName } from '../graphql/formatError.js';
import { extractErrorCodes, type Metrics } from '../observability/metrics.js';
import type { UserService } from '../user.service.js';

const MAX_GRAPHQL_BODY_BYTES = 256 * 1024;

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_GRAPHQL_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const body = request.body;
  if (!body) {
    throw new ValidationError('Request body must be valid JSON');
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_GRAPHQL_BODY_BYTES) {
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

export interface GraphqlHandlerDeps {
  apollo: ApolloServer;
  userService: UserService;
  metrics: Metrics;
}

export function graphqlHandler({ apollo, userService, metrics }: GraphqlHandlerDeps): MiddlewareHandler {
  return async (c) => {
    const body = await readJsonBody(c.req.raw);

    const start = performance.now();
    const response = await apollo.executeHTTPGraphQLRequest({
      httpGraphQLRequest: {
        method: c.req.method,
        headers: new HeaderMap(c.req.raw.headers),
        search: new URL(c.req.url).search,
        body,
      },
      context: () => createContext(c, userService),
    });
    const operation = operationName(body);
    const hasBodyErrors =
      response.body.kind === 'complete' && hasErrors(response.body.string);
    metrics.recordGraphqlOperation(
      operation,
      hasBodyErrors ? 'error' : 'success',
      (performance.now() - start) / 1000,
    );
    if (response.body.kind === 'complete' && hasBodyErrors) {
      for (const code of extractErrorCodes(response.body.string)) {
        metrics.recordGraphqlError(operation, code);
      }
    }

    return new Response(response.body.kind === 'complete' ? response.body.string : null, {
      status: response.status ?? 200,
      headers: Object.fromEntries(response.headers),
    });
  };
}

export function healthHandler(
  ping: () => Promise<'ok' | 'unavailable'>,
): MiddlewareHandler {
  return async (c) => c.json({ status: 'ok', redis: await ping() });
}

export function metricsHandler(metrics: Metrics): MiddlewareHandler {
  return async (c) =>
    c.body(await metrics.getMetrics(), 200, { 'Content-Type': metrics.getContentType() });
}