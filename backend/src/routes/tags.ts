import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { Hono, Context } from "hono";
import { StatusCode } from '../constants/status-code';

export const tagRouter = new Hono<{
  Bindings: {
    DATABASE_URL: string,
    JWT_SECRET: string,
  }
}>();

tagRouter.get('/', async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  const searchQuery = c.req.query('query');
  const limitParam = 4;

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
        take: limitParam,
        orderBy: {
          name: 'asc',
        },
        ...cacheOptions
      });
    } else {
      tags = await prisma.tag.findMany({
        take: limitParam,
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

tagRouter.get('/getPost/:tag', async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  const tagName = c.req.param('tag');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '6');
  const skip = (page - 1) * limit;

  try {
    const [posts, totalPosts] = await Promise.all([
      prisma.post.findMany({
        where: {
          tags: {
            some: {
              tag: {
                name: tagName,
              },
            },
          },
        },
        skip: skip,
        take: limit,
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
        orderBy: {
          id: 'desc'
        },
        cacheStrategy: { ttl: 60 }
      }),
      prisma.post.count({
        where: {
          tags: {
            some: {
              tag: {
                name: tagName,
              },
            },
          },
        },
        cacheStrategy: { ttl: 60 }
      })
    ]);

    const totalPages = Math.ceil(totalPosts / limit);

    return c.json({
      data: posts,
      totalPages: totalPages,
      currentPage: page,
      totalPosts: totalPosts
    }, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get posts for the given tag' }, StatusCode.INTERNAL_SERVER_ERROR);
  }
});