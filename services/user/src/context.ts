import type { Context as HonoContext } from 'hono';
import type { UserService } from './user.service.js';
import { verifyToken } from './utils/token.js';

export interface GraphQLContext {
  user: { id: string } | null;
  userService: UserService;
}

export async function createContext(
  c: HonoContext,
  userService: UserService,
): Promise<GraphQLContext> {
  const header = c.req.header('authorization');
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return { user: token ? await verifyToken(token) : null, userService };
}
