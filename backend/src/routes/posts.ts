import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
import { Context, Hono } from "hono";
import { Redis } from "@upstash/redis/cloudflare";

import { StatusCode } from "../constants/status-code";
import { authMiddleware } from "../middleware/auth";
import {
  createPostSchema,
  updatePostSchema,
  postIdSchema,
} from "@kunalpisolkar24/blogapp-common";

type HonoEnv = {
  Bindings: {
    DATABASE_URL: string;
    JWT_SECRET: string;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    RAILWAY_CONSUMER_WAKEUP_URL: string;
    RAILWAY_WAKEUP_SECRET: string;
  };
  Variables: {
    user: {
      id: number;
    };
  };
};

export const postRouter = new Hono<HonoEnv>();
const SUMMARIZATION_QUEUE_KEY = "summarization_jobs_v1";

async function triggerConsumerWakeup(
  c: Context<HonoEnv>,
  operationDetails: string,
  postId: number
) {
  const wakeupUrl = c.env.RAILWAY_CONSUMER_WAKEUP_URL;
  const wakeupSecret = c.env.RAILWAY_WAKEUP_SECRET;

  console.log(
    `[PRODUCER - ${operationDetails}] Preparing wakeup call for postId ${postId}.`
  );

  if (!wakeupUrl) {
    console.error(
      `[PRODUCER - ${operationDetails}] CRITICAL: RAILWAY_CONSUMER_WAKEUP_URL is undefined or empty. Cannot send wakeup for postId ${postId}.`
    );
    return;
  }
  if (!wakeupSecret) {
    console.error(
      `[PRODUCER - ${operationDetails}] CRITICAL: RAILWAY_WAKEUP_SECRET is undefined or empty. Cannot send wakeup for postId ${postId} as secret is required.`
    );
    return;
  }

  const headers: HeadersInit = {
    "X-Wakeup-Secret": wakeupSecret,
    "Content-Type": "application/json",
  };

  console.log(
    `[PRODUCER - ${operationDetails}] Attempting to send wakeup POST request to: ${wakeupUrl} for postId ${postId}. Headers:`,
    JSON.stringify(headers)
  );

  const wakeupPromise = fetch(wakeupUrl, {
    method: "POST",
    headers: headers,
  })
    .then(async (response) => {
      let responseBodyText = "Could not read response body.";
      try {
        responseBodyText = await response.text();
      } catch (textError) {
        console.error(
          `[PRODUCER - ${operationDetails}] Error reading response body for postId ${postId}:`,
          textError
        );
      }

      console.log(
        `[PRODUCER - ${operationDetails}] Wakeup call for postId ${postId} completed. Status: ${response.status}, StatusText: ${response.statusText}.`
      );
      console.log(
        `[PRODUCER - ${operationDetails}] Wakeup Response Body: ${responseBodyText}`
      );

      if (!response.ok) {
        console.error(
          `[PRODUCER - ${operationDetails}] Wakeup call for postId ${postId} to ${wakeupUrl} FAILED with HTTP Status ${response.status}. Response: ${responseBodyText}`
        );
      } else {
        console.log(
          `[PRODUCER - ${operationDetails}] Wakeup call for postId ${postId} to ${wakeupUrl} SUCCEEDED.`
        );
      }
    })
    .catch((error) => {
      console.error(
        `[PRODUCER - ${operationDetails}] CRITICAL NETWORK/FETCH ERROR during wakeup call for postId ${postId} to ${wakeupUrl}:`
      );
      if (error instanceof Error) {
        console.error(`  Error Name: ${error.name}`);
        console.error(`  Error Message: ${error.message}`);
        if (error.stack) {
          console.error(`  Error Stack: ${error.stack}`);
        }
        // @ts-ignore
        if (error.cause) {
          // @ts-ignore
          console.error(
            `  Error Cause: ${JSON.stringify(
              error.cause,
              Object.getOwnPropertyNames(error.cause)
            )}`
          );
        }
      } else {
        console.error(
          "  Caught a non-Error object during fetch operation:",
          error
        );
      }
    });

  if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
    c.executionCtx.waitUntil(wakeupPromise);
    console.log(
      `[PRODUCER - ${operationDetails}] c.executionCtx.waitUntil() scheduled for wakeup fetch of postId ${postId}.`
    );
  } else {
    console.warn(
      `[PRODUCER - ${operationDetails}] c.executionCtx.waitUntil() not available or not a function. Wakeup fetch for postId ${postId} might not complete if worker instance terminates prematurely. Current execution context:`,
      c.executionCtx
    );
  }
}

postRouter.get("/", async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "6");
  const skip = (page - 1) * limit;
  try {
    const [posts, totalPosts] = await Promise.all([
      prisma.post.findMany({
        skip,
        take: limit,
        include: {
          tags: { include: { tag: true } },
          author: { select: { id: true, username: true, email: true } },
        },
        orderBy: { id: "desc" },
        cacheStrategy: { ttl: 60 },
      }),
      prisma.post.count({ cacheStrategy: { ttl: 60 } }),
    ]);
    const totalPages = Math.ceil(totalPosts / limit);
    return c.json(
      { data: posts, totalPages, currentPage: page, totalPosts },
      StatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching posts:", error.message, error);
    return c.json(
      { error: "Failed to get posts" },
      StatusCode.INTERNAL_SERVER_ERROR
    );
  }
});

postRouter.get("/:id", async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());
  try {
    const postId = parseInt(c.req.param("id"));
    const parsedParams = postIdSchema.safeParse({ id: postId });
    if (!parsedParams.success)
      return c.json(
        { error: parsedParams.error.errors },
        StatusCode.BAD_REQUEST
      );
    const post = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
      include: {
        tags: { include: { tag: true } },
        author: { select: { id: true, username: true, email: true } },
      },
      cacheStrategy: { ttl: 60 },
    });
    if (!post) return c.json({ error: "Post not found" }, StatusCode.NOT_FOUND);
    return c.json(post, StatusCode.OK);
  } catch (error: any) {
    console.error("Error fetching post by ID:", error.message, error);
    return c.json(
      { error: "Failed to get post" },
      StatusCode.INTERNAL_SERVER_ERROR
    );
  }
});

postRouter.post("/", authMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());
  const redis = Redis.fromEnv(c.env);

  try {
    const body = await c.req.json();
    const parsedBody = createPostSchema.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: parsedBody.error.errors }, StatusCode.BAD_REQUEST);
    }
    const userId = c.get("user").id;

    const newPost = await prisma.post.create({
      data: {
        title: parsedBody.data.title,
        body: parsedBody.data.body,
        authorId: userId,
        summaryStatus: "PENDING",
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
        tags: { include: { tag: true } },
        author: { select: { id: true, username: true, email: true } },
      },
    });

    try {
      const jobPayload = { postId: newPost.id, text: newPost.body, attempt: 1 };
      const stringifiedPayload = JSON.stringify(jobPayload);
      console.log(`[PRODUCER - Create] Job Payload Object:`, jobPayload);
      console.log(
        `[PRODUCER - Create] Stringified Payload for Redis:`,
        stringifiedPayload
      );
      await redis.lpush(SUMMARIZATION_QUEUE_KEY, stringifiedPayload);
      console.log(`[PRODUCER - Create] Job enqueued for postId: ${newPost.id}`);

      triggerConsumerWakeup(c, "Create", newPost.id);
    } catch (queueError: any) {
      console.error(
        `[PRODUCER - Create] Failed to enqueue job for postId ${newPost.id}. Error: ${queueError.message}`,
        queueError
      );
    }
    return c.json(newPost, StatusCode.CREATED);
  } catch (error: any) {
    console.error(
      `[PRODUCER - Create] Outer error creating post. Error: ${error.message}`,
      error
    );
    return c.json(
      { error: "Failed to create post" },
      StatusCode.INTERNAL_SERVER_ERROR
    );
  }
});

postRouter.put("/:id", authMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());
  const redis = Redis.fromEnv(c.env);
  try {
    const postId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const parsedParams = postIdSchema.safeParse({ id: postId });
    if (!parsedParams.success)
      return c.json(
        { error: parsedParams.error.errors },
        StatusCode.BAD_REQUEST
      );
    const parsedBody = updatePostSchema.safeParse(body);
    if (!parsedBody.success)
      return c.json({ error: parsedBody.error.errors }, StatusCode.BAD_REQUEST);
    const userId = c.get("user").id;

    const post = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
      select: { authorId: true },
    });
    if (!post) return c.json({ error: "Post not found" }, StatusCode.NOT_FOUND);
    if (post.authorId !== userId)
      return c.json({ error: "Unauthorized" }, StatusCode.UNAUTHORIZED);

    await prisma.postTag.deleteMany({
      where: { postId: parsedParams.data.id },
    });
    const tagsToConnectOrCreate = parsedBody.data.tags.map(
      (tagName: string) => ({
        tag: {
          connectOrCreate: {
            where: { name: tagName },
            create: { name: tagName },
          },
        },
      })
    );

    const updatedPostData = await prisma.post.update({
      where: { id: parsedParams.data.id },
      data: {
        title: parsedBody.data.title,
        body: parsedBody.data.body,
        summary: null,
        summaryStatus: "PENDING",
        tags: { create: tagsToConnectOrCreate },
      },
      select: { id: true, body: true },
    });

    try {
      const jobPayload = {
        postId: updatedPostData.id,
        text: updatedPostData.body,
        attempt: 1,
      };
      const stringifiedPayload = JSON.stringify(jobPayload);
      console.log(`[PRODUCER - Update] Job Payload Object:`, jobPayload);
      console.log(
        `[PRODUCER - Update] Stringified Payload for Redis:`,
        stringifiedPayload
      );
      await redis.lpush(SUMMARIZATION_QUEUE_KEY, stringifiedPayload);
      console.log(
        `[PRODUCER - Update] Job enqueued for updated postId: ${updatedPostData.id}`
      );

      triggerConsumerWakeup(c, "Update", updatedPostData.id);
    } catch (queueError: any) {
      console.error(
        `[PRODUCER - Update] Failed to enqueue job for updated postId ${updatedPostData.id}. Error: ${queueError.message}`,
        queueError
      );
    }

    const finalUpdatedPost = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
      include: {
        tags: { include: { tag: true } },
        author: { select: { id: true, username: true, email: true } },
      },
    });
    return c.json(finalUpdatedPost, StatusCode.OK);
  } catch (error: any) {
    console.error(
      `[PRODUCER - Update] Outer error updating post. Error: ${error.message}`,
      error
    );
    return c.json(
      { error: "Failed to update post" },
      StatusCode.INTERNAL_SERVER_ERROR
    );
  }
});

postRouter.delete("/:id", authMiddleware, async (c) => {
  const prisma = new PrismaClient({
    datasourceUrl: c.env?.DATABASE_URL,
  }).$extends(withAccelerate());
  try {
    const postId = parseInt(c.req.param("id"));
    const parsedParams = postIdSchema.safeParse({ id: postId });
    if (!parsedParams.success)
      return c.json(
        { error: parsedParams.error.errors },
        StatusCode.BAD_REQUEST
      );
    const userId = c.get("user").id;
    const post = await prisma.post.findUnique({
      where: { id: parsedParams.data.id },
    });
    if (!post) return c.json({ error: "Post not found" }, StatusCode.NOT_FOUND);
    if (post.authorId !== userId)
      return c.json({ error: "Unauthorized" }, StatusCode.UNAUTHORIZED);
    await prisma.postTag.deleteMany({
      where: { postId: parsedParams.data.id },
    });
    await prisma.post.delete({ where: { id: parsedParams.data.id } });
    return c.json({ message: "Post deleted successfully" }, StatusCode.OK);
  } catch (error: any) {
    console.error("Error deleting post:", error.message, error);
    return c.json(
      { error: "Failed to delete post" },
      StatusCode.INTERNAL_SERVER_ERROR
    );
  }
});
