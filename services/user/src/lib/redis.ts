import { Redis } from 'ioredis';
import { env } from '../config/env.js';

interface SentinelNode {
  host: string;
  port: number;
}

function parseSentinels(value: string | undefined): SentinelNode[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => {
      const [host, port] = entry.trim().split(':');
      return { host, port: Number(port) };
    })
    .filter((node) => node.host && Number.isInteger(node.port));
}

function createClient(): Redis | null {
  const sentinels = parseSentinels(env.REDIS_SENTINELS);

  if (sentinels.length > 0 && env.REDIS_SENTINEL_NAME) {
    const options: Record<string, string | number | SentinelNode[]> = {
      sentinels,
      name: env.REDIS_SENTINEL_NAME,
    };
    if (env.REDIS_SENTINEL_PASSWORD) {
      options.sentinelPassword = env.REDIS_SENTINEL_PASSWORD;
    }
    if (env.REDIS_PASSWORD) {
      options.password = env.REDIS_PASSWORD;
    }
    return new Redis(options);
  }

  if (env.REDIS_URL) {
    return new Redis(env.REDIS_URL);
  }

  return null;
}

export const redis = createClient();

export async function closeRedis(): Promise<void> {
  if (redis) {
    redis.disconnect();
  }
}

export async function pingRedis(): Promise<'ok' | 'unavailable'> {
  try {
    await redis?.ping();
    return 'ok';
  } catch {
    return 'unavailable';
  }
}
