import type { GraphQLContext } from '../context.js';
import { UnauthorizedError, UserNotFoundError } from '../errors.js';
import { signinSchema, signupSchema, updateProfileSchema, validate } from '../schemas.js';

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
    ) =>
      ctx.userService.findAll({
        limit: Math.min(Math.max(Math.floor(limit), 1), 50),
        cursor: cursor ?? undefined,
      }),
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
  },
};
