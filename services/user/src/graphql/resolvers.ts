import type { GraphQLContext } from '../context.js';
import { UnauthorizedError, UserNotFoundError, ValidationError } from '../errors.js';
import { signinSchema, signupSchema, updateProfileSchema, validate } from '../schemas.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidCursor(cursor: string | null | undefined): void {
  if (cursor !== undefined && cursor !== null && !UUID_PATTERN.test(cursor)) {
    throw new ValidationError('cursor must be a valid user id');
  }
}

export const resolvers = {
  Query: {
    me: (_: unknown, __: unknown, ctx: GraphQLContext) =>
      ctx.user ? ctx.userService.findById(ctx.user.id) : null,
    user: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const user = await ctx.userService.findById(id);
      if (!user) {
        throw new UserNotFoundError();
      }
      return user;
    },
    users: (
      _: unknown,
      { limit = 20, cursor }: { limit?: number; cursor?: string | null },
      ctx: GraphQLContext,
    ) => {
      assertValidCursor(cursor);
      return ctx.userService.findAll({
        limit: Math.min(Math.max(Math.floor(limit), 1), 50),
        cursor: cursor ?? undefined,
      });
    },
  },
  Mutation: {
    signup: (_: unknown, args: unknown, ctx: GraphQLContext) =>
      ctx.userService.signup(validate(signupSchema, args)),
    signin: (_: unknown, args: unknown, ctx: GraphQLContext) =>
      ctx.userService.signin(validate(signinSchema, args)),
    updateProfile: (_: unknown, args: unknown, ctx: GraphQLContext) => {
      if (!ctx.user) {
        throw new UnauthorizedError();
      }
      return ctx.userService.updateProfile(ctx.user.id, validate(updateProfileSchema, args));
    },
  },
  User: {
    __resolveReference: (ref: { id: string }, ctx: GraphQLContext) =>
      ctx.userService.findById(ref.id),
    email: (obj: { id: string; email: string | null }, ctx: GraphQLContext) =>
      ctx.user?.id === obj.id ? obj.email : null,
  },
};
