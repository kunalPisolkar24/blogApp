import type { PrismaClient, User } from '../generated/prisma/client.js';
import { toDomainError } from '../errors.js';
import type { PaginationArgs } from '../domain/user.js';
import {
  isConnectionEstablishmentError,
  withRetry,
  type RetryErrorCheck,
} from '../lib/retry.js';
import type { Metrics } from '../observability/metrics.js';
import type { UpdateProfileInput } from '../schemas.js';

export class UserRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly primary: PrismaClient,
    private readonly metrics?: Metrics,
  ) {}

  async create(data: {
    email: string;
    username: string;
    password: string;
    name: string;
  }): Promise<User> {
    return this.retried(
      'create',
      async () => {
        try {
          return await this.prisma.user.create({ data });
        } catch (error) {
          throw toDomainError(error);
        }
      },
      {
        // Writes retry only on connection-establishment errors: the query was
        // never sent, so a retry cannot double-insert.
        retryOn: isConnectionEstablishmentError,
      },
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.retried('findByEmail', () => this.primary.user.findUnique({ where: { email } }));
  }

  async findByEmailOrUsername(email: string, username: string): Promise<User | null> {
    return this.retried('findByEmailOrUsername', () =>
      this.prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      }),
    );
  }

  async findById(id: string): Promise<User | null> {
    return this.retried('findById', () => this.prisma.user.findUnique({ where: { id } }));
  }

  async findAll({ limit, cursor }: PaginationArgs): Promise<User[]> {
    return this.retried('findAll', () =>
      this.prisma.user.findMany({
        take: limit,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'desc' },
      }),
    );
  }

  async update(id: string, data: UpdateProfileInput): Promise<User> {
    return this.retried(
      'update',
      async () => {
        try {
          return await this.prisma.user.update({ where: { id }, data });
        } catch (error) {
          throw toDomainError(error);
        }
      },
      {
        retryOn: isConnectionEstablishmentError,
      },
    );
  }

  private retried<T>(
    operation: string,
    run: () => Promise<T>,
    options: { retryOn?: RetryErrorCheck } = {},
  ): Promise<T> {
    return withRetry(() => this.timed(operation, run), options);
  }

  private async timed<T>(operation: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await run();
      this.metrics?.recordDbQuery(operation, 'success', (performance.now() - start) / 1000);
      return result;
    } catch (error) {
      this.metrics?.recordDbQuery(operation, 'error', (performance.now() - start) / 1000);
      throw error;
    }
  }
}
