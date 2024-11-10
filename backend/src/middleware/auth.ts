import { Next } from "hono";
import { verify } from "hono/jwt";
import { StatusCode } from '../constants/status-code';

export const authMiddleware = async (c: any, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Unauthorized' }, StatusCode.UNAUTHORIZED);
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return c.json({ error: 'Unauthorized' }, StatusCode.UNAUTHORIZED);
  }

  try {
    const payload = await verify(token, c.env.JWT_SECRET);
    c.set('user', payload);
    await next();
  } catch (error) {
    return c.json({ error: 'Unauthorized' }, StatusCode.UNAUTHORIZED);
  }
};
