import { describe, it, expect } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import {
  DomainError,
  InvalidCredentialsError,
  UnauthorizedError,
  UserAlreadyExistsError,
  UserNotFoundError,
  ValidationError,
  toDomainError,
} from '../errors.js';

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Prisma client error', {
    code,
    clientVersion: '7.9.1',
  });

describe('domain error classes', () => {
  const cases = [
    { error: new UserAlreadyExistsError(), code: 'USER_ALREADY_EXISTS', status: 409 },
    { error: new InvalidCredentialsError(), code: 'INVALID_CREDENTIALS', status: 401 },
    { error: new UserNotFoundError(), code: 'USER_NOT_FOUND', status: 404 },
    { error: new ValidationError('bad input'), code: 'VALIDATION_ERROR', status: 400 },
    { error: new UnauthorizedError(), code: 'UNAUTHORIZED', status: 401 },
  ];

  it.each(cases)('$code maps to HTTP $status with a message', ({ error, code, status }) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
    expect(error.message.length).toBeGreaterThan(0);
  });
});

describe('toDomainError', () => {
  it('maps a P2002 unique constraint to UserAlreadyExistsError', () => {
    expect(toDomainError(prismaError('P2002'))).toBeInstanceOf(UserAlreadyExistsError);
  });

  it('maps a P2025 record-not-found to UserNotFoundError', () => {
    expect(toDomainError(prismaError('P2025'))).toBeInstanceOf(UserNotFoundError);
  });

  it('returns domain errors unchanged', () => {
    const error = new UserNotFoundError();
    expect(toDomainError(error)).toBe(error);
  });

  it('rethrows errors it cannot map', () => {
    expect(() => toDomainError(new Error('database unreachable'))).toThrow('database unreachable');
  });
});
