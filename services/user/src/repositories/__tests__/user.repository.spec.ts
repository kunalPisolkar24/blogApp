import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRepository } from '../user.repository.js';
import { Prisma, type PrismaClient, type User } from '../../generated/prisma/client.js';
import {
  UserAlreadyExistsError,
  UserNotFoundError,
} from '../../errors.js';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  password: 'scrypt:hash',
  name: 'Alice',
  bio: null,
  avatarUrl: null,
  bannerUrl: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Prisma client error', {
    code,
    clientVersion: '7.9.1',
  });

const createUserMocks = () => ({
  user: {
    findUnique: vi.fn<(args: Prisma.UserFindUniqueArgs) => Promise<User | null>>(),
    findMany: vi.fn<(args: Prisma.UserFindManyArgs) => Promise<User[]>>(),
    create: vi.fn<(args: Prisma.UserCreateArgs) => Promise<User>>(),
    update: vi.fn<(args: Prisma.UserUpdateArgs) => Promise<User>>(),
  },
});

type PrismaUserMocks = ReturnType<typeof createUserMocks>;

describe('UserRepository', () => {
  let repository: UserRepository;
  let prisma: PrismaUserMocks;
  let primary: PrismaUserMocks;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma = createUserMocks();
    primary = createUserMocks();
    repository = new UserRepository(
      prisma as unknown as PrismaClient,
      primary as unknown as PrismaClient,
    );
  });

  describe('create', () => {
    const data = {
      email: 'alice@example.com',
      username: 'alice',
      password: 'hashed-password',
      name: 'alice',
    };

    it('creates the user with the given data', async () => {
      prisma.user.create.mockResolvedValue(makeUser());

      await expect(repository.create(data)).resolves.toEqual(makeUser());
      expect(prisma.user.create).toHaveBeenCalledWith({ data });
    });

    it('maps a unique-constraint violation to UserAlreadyExistsError', async () => {
      prisma.user.create.mockRejectedValue(prismaError('P2002'));

      await expect(repository.create(data)).rejects.toBeInstanceOf(UserAlreadyExistsError);
    });

    it('rethrows unexpected errors as-is', async () => {
      prisma.user.create.mockRejectedValue(new Error('database unreachable'));

      await expect(repository.create(data)).rejects.toThrow('database unreachable');
    });
  });

  describe('findByEmail', () => {
    it('looks the user up on the primary client', async () => {
      const user = makeUser();
      primary.user.findUnique.mockResolvedValue(user);

      await expect(repository.findByEmail('alice@example.com')).resolves.toEqual(user);
      expect(primary.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when the user does not exist', async () => {
      primary.user.findUnique.mockResolvedValue(null);

      await expect(repository.findByEmail('nobody@example.com')).resolves.toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the user', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(repository.findById('u1')).resolves.toEqual(makeUser());
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });

    it('returns null when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(repository.findById('u1')).resolves.toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns all users when no cursor is given', async () => {
      const users = [makeUser({ id: 'u2' }), makeUser({ id: 'u1' })];
      prisma.user.findMany.mockResolvedValue(users);

      await expect(repository.findAll({ limit: 10 })).resolves.toEqual(users);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        cursor: undefined,
        orderBy: { id: 'desc' },
      });
    });

    it('skips the cursor user when paginating', async () => {
      prisma.user.findMany.mockResolvedValue([makeUser({ id: 'u1' })]);

      await repository.findAll({ limit: 10, cursor: 'u2' });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 1,
        cursor: { id: 'u2' },
        orderBy: { id: 'desc' },
      });
    });
  });

  describe('update', () => {
    const data = { name: 'Alice Updated' };

    it('updates the user with the given data', async () => {
      prisma.user.update.mockResolvedValue(makeUser(data));

      await expect(repository.update('u1', data)).resolves.toEqual(makeUser(data));
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data });
    });

    it('maps a missing record to UserNotFoundError', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));

      await expect(repository.update('u1', data)).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it('maps a unique-constraint violation to UserAlreadyExistsError', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2002'));

      await expect(repository.update('u1', data)).rejects.toBeInstanceOf(
        UserAlreadyExistsError,
      );
    });
  });
});
