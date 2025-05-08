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
  const searchQuery = c.req.query('query');
  const limit = 4;

  try {
    let tags;
    const cacheOptions = {
      cacheStrategy: {
        ttl: 300,
      }
    };

    if (searchQuery && searchQuery.trim() !== "") {
      tags = await prisma.tag.findMany({
        where: {
          name: {
            contains: searchQuery.trim(),
            mode: 'insensitive',
          },
        },
        take: limit,
        orderBy: {
          name: 'asc',
        },
        ...cacheOptions
      });
    } else {
      tags = await prisma.tag.findMany({
        take: limit,
        orderBy: {
          name: 'asc',
        },
        ...cacheOptions
      });
    }
    return c.json(tags, StatusCode.OK);
  } catch (error) {
    console.error('Failed to get tags:', error);
    return c.json({ error: 'Failed to get tags' }, StatusCode.INTERNAL_SERVER_ERROR);
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
      cacheStrategy: { ttl: 600 }
    });

    if (posts.length === 0) {
      return c.json({ error: 'No posts found for the given tag' }, StatusCode.NOT_FOUND);
    }

    return c.json(posts, StatusCode.OK);
  } catch (error) {
    console.error('Failed to get posts for the given tag:', error);
    return c.json({ error: 'Failed to get posts for the given tag' }, StatusCode.INTERNAL_SERVER_ERROR);
  }
});