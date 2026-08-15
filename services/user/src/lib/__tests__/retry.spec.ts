import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import {
  isConnectionEstablishmentError,
  isTransientDbError,
  withRetry,
} from '../retry.js';

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Prisma client error', {
    code,
    clientVersion: '7.9.1',
  });

describe('isTransientDbError', () => {
  it('classifies prisma connection errors as transient', () => {
    expect(isTransientDbError(prismaError('P1001'))).toBe(true);
    expect(isTransientDbError(prismaError('P1002'))).toBe(true);
    expect(isTransientDbError(prismaError('P1017'))).toBe(true);
  });

  it('classifies pg connection errors as transient', () => {
    for (const message of [
      'connect ECONNREFUSED 127.0.0.1:5432',
      'socket hang up with ECONNRESET',
      'Connection terminated unexpectedly',
      'ETIMEDOUT',
    ]) {
      expect(isTransientDbError(new Error(message))).toBe(true);
    }
  });

  it('treats data errors as fatal', () => {
    expect(isTransientDbError(prismaError('P2002'))).toBe(false);
    expect(isTransientDbError(prismaError('P2025'))).toBe(false);
    expect(isTransientDbError(prismaError('P2003'))).toBe(false);
    expect(isTransientDbError(new Error('something else'))).toBe(false);
  });
});

describe('isConnectionEstablishmentError', () => {
  it('classifies only connection-establishment errors as retryable for writes', () => {
    expect(isConnectionEstablishmentError(prismaError('P1001'))).toBe(true);
    expect(isConnectionEstablishmentError(new Error('connect ECONNREFUSED'))).toBe(true);
    expect(isConnectionEstablishmentError(prismaError('P1002'))).toBe(false);
    expect(isConnectionEstablishmentError(prismaError('P1017'))).toBe(false);
    expect(isConnectionEstablishmentError(prismaError('P2002'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries transient failures and succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce('done');

    await expect(withRetry(op, { maxRetries: 2, baseMs: 1 })).resolves.toBe('done');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on fatal errors without retrying', async () => {
    const op = vi.fn().mockRejectedValue(prismaError('P2002'));

    await expect(withRetry(op, { maxRetries: 2, baseMs: 1 })).rejects.toEqual(
      prismaError('P2002'),
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('caps attempts at maxRetries and rethrows', async () => {
    const op = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(withRetry(op, { maxRetries: 2, baseMs: 1 })).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff with jitter between attempts', async () => {
    const sleeps: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((callback: () => void, ms?: number) => {
      if (ms !== undefined) {
        sleeps.push(ms);
      }
      callback();
      return 0 as unknown as NodeJS.Timeout;
    });

    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce('done');

    await withRetry(op, { maxRetries: 2, baseMs: 100 });

    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[0]).toBeLessThan(150);
    expect(sleeps[1]).toBeGreaterThanOrEqual(200);
    expect(sleeps[1]).toBeLessThan(300);
  });

  it('uses a custom retry predicate when provided', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('custom transient'))
      .mockResolvedValueOnce('done');

    await expect(
      withRetry(op, { maxRetries: 1, baseMs: 1, retryOn: () => true }),
    ).resolves.toBe('done');
    expect(op).toHaveBeenCalledTimes(2);
  });
});