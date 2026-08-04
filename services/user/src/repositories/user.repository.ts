import type { PrismaClient, User } from '../generated/prisma/client.js';
import { toDomainError } from '../errors.js';
import type { PaginationArgs } from '../domain/user.js';
import type { UpdateProfileInput } from '../schemas.js';

export class UserRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly primary: PrismaClient,
  ) {}

  async create(data: {
    email: string;
    username: string;
    password: string;
    name: string;
  }): Promise<User> {
    try {
      return await this.prisma.user.create({ data });
    } catch (error) {
      throw toDomainError(error);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.primary.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAll({ limit, cursor }: PaginationArgs): Promise<User[]> {
    return this.prisma.user.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'desc' },
    });
  }

  async update(id: string, data: UpdateProfileInput): Promise<User> {
    try {
      return await this.prisma.user.update({ where: { id }, data });
    } catch (error) {
      throw toDomainError(error);
    }
  }
}
