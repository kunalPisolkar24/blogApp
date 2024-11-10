import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { Hono } from "hono";
import { sign } from "hono/jwt";

import { StatusCode } from '../constants/status-code';
import { authMiddleware } from '../middleware/auth';
import { signupSchema, signinSchema, userIdSchema } from '@kunalpisolkar24/blogapp-common';

export const userRouter = new Hono<{
  Bindings: {
    DATABASE_URL: string,
    JWT_SECRET: string,
  }
}>();

userRouter.post('/signup', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const body = await c.req.json();

    const parsedBody = signupSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: parsedBody.error.errors }, StatusCode.BAD_REQUEST);
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(parsedBody.data.password);
    const hash = await crypto.subtle.digest('SHA-256', data);

    const passwordHashHex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const newUser = await prisma.user.create({
      data: {
        email: parsedBody.data.email,
        password: passwordHashHex,
        username: parsedBody.data.username,
      },
    });

    const jwt = await sign({ id: newUser.id }, c.env.JWT_SECRET);

    return c.json({ newUser, jwt }, StatusCode.CREATED);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to create user' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

userRouter.post('/signin', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const body = await c.req.json();

    const parsedBody = signinSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: parsedBody.error.errors }, StatusCode.BAD_REQUEST);
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(parsedBody.data.password);
    const hash = await crypto.subtle.digest('SHA-256', data);

    const passwordHashHex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const user = await prisma.user.findUnique({
      where: { email: parsedBody.data.email },
    });

    if (!user || user.password !== passwordHashHex) {
      return c.json({ error: 'Invalid email or password' }, StatusCode.UNAUTHORIZED);
    }

    const jwt = await sign({ id: user.id }, c.env.JWT_SECRET);

    return c.json({ user, jwt }, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to sign in' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

userRouter.use('/users', authMiddleware);

userRouter.get('/users/:id', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const userId = parseInt(c.req.param('id'));

    const parsedParams = userIdSchema.safeParse({ id: userId });
    if (!parsedParams.success) {
      return c.json({ error: parsedParams.error.errors }, StatusCode.BAD_REQUEST);
    }

    const user = await prisma.user.findUnique({
      where: { id: parsedParams.data.id },
      select: { email: true, username: true },
    });

    if (!user) {
      return c.json({ error: 'User not found' }, StatusCode.NOT_FOUND);
    }

    return c.json(user, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get user details' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

userRouter.get('/users', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, username: true },
    });

    return c.json(users, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get users' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});
