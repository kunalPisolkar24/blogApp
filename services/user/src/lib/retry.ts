import { Prisma } from '../generated/prisma/client.js';

export type RetryErrorCheck = (error: unknown) => boolean;

const CONNECTION_ESTABLISHMENT_PATTERN =
  /ECONNREFUSED|ETIMEDOUT|Connection pool timeout|connect ECONNREFUSED/i;

const TRANSIENT_PATTERN =
  /ECONNRESET|Connection terminated|Connection terminated unexpectedly/i;

export function isConnectionEstablishmentError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P1001';
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  return error instanceof Error && CONNECTION_ESTABLISHMENT_PATTERN.test(error.message);
}

export function isTransientDbError(error: unknown): boolean {
  if (isConnectionEstablishmentError(error)) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P1002' || error.code === 'P1017';
  }
  return error instanceof Error && TRANSIENT_PATTERN.test(error.message);
}

export interface RetryOptions {
  maxRetries?: number;
  baseMs?: number;
  retryOn?: RetryErrorCheck;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 2, baseMs = 100, retryOn = isTransientDbError } = options;
  let attempt = 0;

  const run = async (): Promise<T> => {
    try {
      return await op();
    } catch (error) {
      if (attempt >= maxRetries || !retryOn(error)) {
        throw error;
      }
      attempt += 1;
      const backoff = baseMs * 2 ** (attempt - 1);
      await sleep(backoff + backoff * 0.5 * Math.random());
      return run();
    }
  };

  return run();
}