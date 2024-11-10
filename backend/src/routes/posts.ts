import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { Context, Hono } from "hono";

import { StatusCode } from '../constants/status-code';
import { authMiddleware } from '../middleware/auth';
import { createPostSchema, updatePostSchema, postIdSchema } from '@kunalpisolkar24/blogapp-common';

export const postRouter = new Hono<{
  Bindings: {
    DATABASE_URL: string,
    JWT_SECRET: string,
  }
}>();

postRouter.get('/', async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const posts = await prisma.post.findMany({
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
            email: true
          }
        },
      },
    });

    return c.json(posts, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get posts' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

postRouter.get('/:id', async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const postId = parseInt(c.req.param('id'));

    const parsedParams = postIdSchema.safeParse({ id: postId });
    if (!parsedParams.success) {
      return c.json({ error: parsedParams.error.errors }, StatusCode.BAD_REQUEST);
    }

    const post = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
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
          }
        },
      },
    });

    if (!post) {
      return c.json({ error: 'Post not found' }, StatusCode.NOT_FOUND);
    }

    return c.json(post, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get post' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

postRouter.post("/", authMiddleware, async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const body = await c.req.json();

    const parsedBody = createPostSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: parsedBody.error.errors }, StatusCode.BAD_REQUEST);
    }

    const userId = c.get('user').id;

    const newPost = await prisma.post.create({
      data: {
        title: parsedBody.data.title,
        body: parsedBody.data.body,
        authorId: userId,
        tags: {
          create: parsedBody.data.tags.map((tagName: string) => ({
            tag: {
              connectOrCreate: {
                where: { name: tagName },
                create: { name: tagName },
              },
            },
          })),
        },
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    return c.json(newPost, StatusCode.CREATED);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to create post' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

postRouter.put('/:id', authMiddleware, async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const postId = parseInt(c.req.param('id'));
    const body = await c.req.json();

    const parsedParams = postIdSchema.safeParse({ id: postId });
    if (!parsedParams.success) {
      return c.json({ error: parsedParams.error.errors }, StatusCode.BAD_REQUEST);
    }

    const parsedBody = updatePostSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: parsedBody.error.errors }, StatusCode.BAD_REQUEST);
    }

    const userId = c.get('user').id;

    const post = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
      include: { author: true },
    });

    if (!post) {
      return c.json({ error: 'Post not found' }, StatusCode.NOT_FOUND);
    }

    if (post.authorId !== userId) {
      return c.json({ error: 'Unauthorized' }, StatusCode.UNAUTHORIZED);
    }

    await prisma.postTag.deleteMany({
      where: { postId },
    });

    const tags = await Promise.all(
      parsedBody.data.tags.map(async (tagName: string) => {
        return await prisma.tag.upsert({
          where: { name: tagName },
          update: {},
          create: { name: tagName },
        });
      })
    );

    const postTags = tags.map((tag) => ({
      postId,
      tagId: tag.id,
    }));

    await prisma.postTag.createMany({
      data: postTags,
    });

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: {
        title: parsedBody.data.title,
        body: parsedBody.data.body,
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

    return c.json(updatedPost, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to update post' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});

postRouter.delete('/:id', authMiddleware, async (c: Context) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env?.DATABASE_URL }).$extends(withAccelerate());
  try {
    const postId = parseInt(c.req.param('id'));

    const parsedParams = postIdSchema.safeParse({ id: postId });
    if (!parsedParams.success) {
      return c.json({ error: parsedParams.error.errors }, StatusCode.BAD_REQUEST);
    }

    const userId = c.get('user').id;

    const post = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
      include: { author: true },
    });

    if (!post) {
      return c.json({ error: 'Post not found' }, StatusCode.NOT_FOUND);
    }

    if (post.authorId !== userId) {
      return c.json({ error: 'Unauthorized' }, StatusCode.UNAUTHORIZED);
    }

    await prisma.postTag.deleteMany({
      where: { postId },
    });

    await prisma.post.delete({
      where: { id: postId },
    });

    return c.json({ message: 'Post deleted successfully' }, StatusCode.OK);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to delete post' }, StatusCode.INTERNAL_SERVER_ERROR);
  } finally {
    await prisma.$disconnect();
  }
});
