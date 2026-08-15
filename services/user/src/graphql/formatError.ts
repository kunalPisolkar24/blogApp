import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { DomainError } from '../errors.js';
import { logger } from '../observability/logger.js';

export function hasErrors(body: string): boolean {
  try {
    return Array.isArray(JSON.parse(body).errors);
  } catch {
    return false;
  }
}

export function operationName(body: unknown): string {
  if (
    body !== null &&
    typeof body === 'object' &&
    'operationName' in body &&
    typeof body.operationName === 'string' &&
    body.operationName.length > 0
  ) {
    return body.operationName;
  }
  return 'anonymous';
}

export function unwrapDomain(error: unknown): DomainError | null {
  const inner =
    error instanceof Error && 'originalError' in error
      ? (error as { originalError?: unknown }).originalError
      : error;
  return inner instanceof DomainError ? inner : null;
}

export function formatError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const domain = unwrapDomain(error);
  if (domain) {
    return {
      message: domain.message,
      path: formatted.path,
      extensions: { code: domain.code },
    };
  }
  if (error instanceof GraphQLError && error.originalError === undefined) {
    return formatted;
  }
  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    'internal graphql error',
  );
  return { message: 'Internal server error', extensions: { code: 'INTERNAL_ERROR' } };
}