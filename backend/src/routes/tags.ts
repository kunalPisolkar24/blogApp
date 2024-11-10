import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { Hono } from "hono";

import { StatusCode } from '../constants/status-code';

export const tagRouter = new Hono<{
  Bindings: {
    DATABASE_URL: string,
    JWT_SECRET: string,
  }
}>();

tagRouter.get('/', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const tags = await prisma.tag.findMany();
    return c.json(tags, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get tags' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

tagRouter.get('/getPost/:tag', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const tagName = c.req.param('tag');

    const posts = await prisma.post.findMany({
      where: {
        tags: {
          some: {
            tag: {
              name: tagName,
            },
          },
        },
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
        author: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (posts.length === 0) {
      return c.json({ error: 'No posts found for the given tag' }, StatusCode.NOT_FOUND);
    }

    return c.json(posts, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get posts for the given tag' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});
