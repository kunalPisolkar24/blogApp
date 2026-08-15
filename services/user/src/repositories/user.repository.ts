import type { PrismaClient, User } from '../generated/prisma/client.js';
import { toDomainError } from '../errors.js';
import type { PaginationArgs } from '../domain/user.js';
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
    return this.timed('create', async () => {
      try {
        return await this.prisma.user.create({ data });
      } catch (error) {
        throw toDomainError(error);
      }
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.timed('findByEmail', () => this.primary.user.findUnique({ where: { email } }));
  }

  async findByEmailOrUsername(email: string, username: string): Promise<User | null> {
    return this.timed('findByEmailOrUsername', () =>
      this.prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      }),
    );
  }

  async findById(id: string): Promise<User | null> {
    return this.timed('findById', () => this.prisma.user.findUnique({ where: { id } }));
  }

  async findAll({ limit, cursor }: PaginationArgs): Promise<User[]> {
    return this.timed('findAll', () =>
      this.prisma.user.findMany({
        take: limit,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'desc' },
      }),
    );
  }

  async update(id: string, data: UpdateProfileInput): Promise<User> {
    return this.timed('update', async () => {
      try {
        return await this.prisma.user.update({ where: { id }, data });
      } catch (error) {
        throw toDomainError(error);
      }
    });
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
