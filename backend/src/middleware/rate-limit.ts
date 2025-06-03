import { Next, Context } from 'hono';
import { Redis } from '@upstash/redis/cloudflare';
import { StatusCode } from '../constants/status-code';

const RATELIMIT_WINDOW_MS = 60000;
const RATELIMIT_MAX_REQUESTS = 150;

type RateLimitEnv = {
    Bindings: {
        UPSTASH_RATELIMIT_REDIS_REST_URL: string;
        UPSTASH_RATELIMIT_REDIS_REST_TOKEN: string;
    }
}

let redis: Redis | null = null;

export const rateLimitMiddleware = async (c: Context<RateLimitEnv>, next: Next) => {
    if (!c.env.UPSTASH_RATELIMIT_REDIS_REST_URL || !c.env.UPSTASH_RATELIMIT_REDIS_REST_TOKEN) {
        console.error("Rate limit Redis URL or Token not configured. Skipping rate limit.");
        await next();
        return;
    }

    if (!redis) {
        redis = new Redis({
            url: c.env.UPSTASH_RATELIMIT_REDIS_REST_URL,
            token: c.env.UPSTASH_RATELIMIT_REDIS_REST_TOKEN,
        });
    }

    const ip = c.req.header('cf-connecting-ip') || 'unknown-ip';
    const key = `rate_limit:${ip}`;

    try {
        const currentRequests = await redis.incr(key);

        if (currentRequests === 1) {
            await redis.pexpire(key, RATELIMIT_WINDOW_MS);
        }

        if (currentRequests > RATELIMIT_MAX_REQUESTS) {
            return c.json({ error: 'Too many requests' }, StatusCode.RATELIMIT);
        }
    } catch (error) {
        console.error("Rate limit Redis error:", error);
    }

    await next();
};