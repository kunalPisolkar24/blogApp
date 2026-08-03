import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Prisma } from './generated/prisma/client.js';

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: ContentfulStatusCode;
}

export class UserAlreadyExistsError extends DomainError {
  readonly code = 'USER_ALREADY_EXISTS';
  readonly httpStatus = 409;
  constructor() {
    super('A user with that email or username already exists');
  }
}

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly httpStatus = 401;
  constructor() {
    super('Invalid email or password');
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = 'USER_NOT_FOUND';
  readonly httpStatus = 404;
  constructor() {
    super('User not found');
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
  readonly httpStatus = 401;
  constructor() {
    super('Authentication required');
  }
}

export function toDomainError(error: unknown): DomainError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new UserAlreadyExistsError();
    }
    if (error.code === 'P2025') {
      return new UserNotFoundError();
    }
  }
  if (error instanceof DomainError) {
    return error;
  }
  throw error;
}
