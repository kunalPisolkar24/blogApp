import { randomBytes } from 'node:crypto';
import type { PrismaClient, User } from './generated/prisma/client.js';
import { env } from './config/env.js';
import { redis } from './lib/redis.js';
import { primaryDb } from './lib/prisma.js';
import {
  InvalidCredentialsError,
  UserNotFoundError,
  toDomainError,
} from './errors.js';
import type { SigninInput, SignupInput, UpdateProfileInput } from './schemas.js';
import { hashPassword, verifyPassword } from './utils/password.js';
import { signToken } from './utils/token.js';

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
}

export interface PaginationArgs {
  limit: number;
  cursor?: string;
}

export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

let dummyHash: string | null = null;

export class UserService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly primary = primaryDb(),
  ) {}

  async signup(data: SignupInput): Promise<AuthResponse> {
    const password = await hashPassword(data.password);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          password,
          name: data.username,
        },
      });
    } catch (error) {
      throw toDomainError(error);
    }
    await this.invalidateUserLists();
    return this.authResponse(user);
  }

  async signin(data: SigninInput): Promise<AuthResponse> {
    const user = await this.primary.user.findUnique({ where: { email: data.email } });
    const hash = user?.password ?? (dummyHash ??= await hashPassword(randomBytes(32).toString('hex')));
    const valid = await verifyPassword(data.password, hash);
    if (!user || !valid) {
      throw new InvalidCredentialsError();
    }
    return this.authResponse(user);
  }

  async findById(id: string): Promise<UserResponse | null> {
    return this.cached(`user:${id}`, env.REDIS_CACHE_TTL_MS, async () => {
      const user = await this.prisma.user.findUnique({ where: { id } });
      return user ? toUserResponse(user) : null;
    });
  }

  async findAll({ limit, cursor }: PaginationArgs): Promise<UserResponse[]> {
    const key = `users:${limit}:${cursor ?? ''}`;
    const ttl = env.REDIS_CACHE_TTL_MS;
    return (await this.cached(key, ttl, async () => {
      const users = await this.prisma.user.findMany({
        take: limit,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'desc' },
      });
      return users.map(toUserResponse);
    })) ?? [];
  }

  async updateProfile(userId: string, data: UpdateProfileInput): Promise<UserResponse> {
    try {
      const user = await this.prisma.user.update({ where: { id: userId }, data });
      await this.invalidateUser(userId);
      return toUserResponse(user);
    } catch (error) {
      throw toDomainError(error);
    }
  }

  private async authResponse(user: User): Promise<AuthResponse> {
    return {
      token: await signToken(user.id),
      user: toUserResponse(user),
    };
  }

  private async cached<T>(
    key: string,
    ttlMs: number,
    miss: () => Promise<T | null>,
  ): Promise<T | null> {
    if (!redis) {
      return miss();
    }
    try {
      const raw = await redis.get(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
    } catch {
      return miss();
    }
    const value = await miss();
    if (value !== null) {
      try {
        await redis.set(key, JSON.stringify(value), 'PX', ttlMs);
      } catch {
        /* cache write is best-effort */
      }
    }
    return value;
  }

  private async invalidateUser(userId: string): Promise<void> {
    if (!redis) {
      return;
    }
    try {
      await redis.del(`user:${userId}`);
      await this.invalidateUserLists();
    } catch {
      /* cache invalidation is best-effort */
    }
  }

  private async invalidateUserLists(): Promise<void> {
    if (!redis) {
      return;
    }
    try {
      const keys = await redis.keys('users:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      /* cache invalidation is best-effort */
    }
  }
}
