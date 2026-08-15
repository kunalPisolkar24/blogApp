import type { User } from './generated/prisma/client.js';
import type { AuthResponse, PaginationArgs, UserResponse } from './domain/user.js';
import { toUserResponse } from './domain/user.js';
import { InvalidCredentialsError, UserAlreadyExistsError } from './errors.js';
import { CacheManager } from './lib/cache.js';
import type { Metrics } from './observability/metrics.js';
import { UserRepository } from './repositories/user.repository.js';
import type { SigninInput, SignupInput, UpdateProfileInput } from './schemas.js';
import { getDummyHash, hashPassword, verifyPassword } from './utils/password.js';
import { signToken } from './utils/token.js';

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly cache: CacheManager,
    private readonly cacheTtlMs: number,
    private readonly metrics?: Metrics,
  ) {}

  async signup(data: SignupInput): Promise<AuthResponse> {
    const existing = await this.users.findByEmailOrUsername(data.email, data.username);
    if (existing) {
      throw new UserAlreadyExistsError();
    }
    const password = await hashPassword(data.password);
    const user = await this.users.create({
      email: data.email,
      username: data.username,
      password,
      name: data.username,
    });
    await this.cache.invalidateUserLists();
    this.metrics?.recordSignup();
    return this.authResponse(user);
  }

  async signin(data: SigninInput): Promise<AuthResponse> {
    const user = await this.users.findByEmail(data.email);
    const hash = user?.password ?? (await getDummyHash());
    const valid = await verifyPassword(data.password, hash);
    if (!user || !valid) {
      this.metrics?.recordSigninFailure();
      throw new InvalidCredentialsError();
    }
    this.metrics?.recordSignin();
    return this.authResponse(user);
  }

  async findById(id: string): Promise<UserResponse | null> {
    return this.cache.read(`user:${id}`, this.cacheTtlMs, async () => {
      const user = await this.users.findById(id);
      return user ? toUserResponse(user) : null;
    });
  }

  async findAll({ limit, cursor }: PaginationArgs): Promise<UserResponse[]> {
    const key = `users:${limit}:${cursor ?? ''}`;
    return (await this.cache.read(key, this.cacheTtlMs, async () => {
      const users = await this.users.findAll({ limit, cursor });
      return users.map(toUserResponse);
    })) ?? [];
  }

  async updateProfile(userId: string, data: UpdateProfileInput): Promise<UserResponse> {
    const user = await this.users.update(userId, data);
    await this.invalidateUser(userId);
    return toUserResponse(user);
  }

  private async authResponse(user: User): Promise<AuthResponse> {
    return {
      token: await signToken(user.id),
      user: toUserResponse(user),
    };
  }

  private async invalidateUser(userId: string): Promise<void> {
    await this.cache.invalidateKey(`user:${userId}`);
    await this.cache.invalidateUserLists();
  }
}
