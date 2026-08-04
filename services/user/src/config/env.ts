import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_REPLICA: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  DATABASE_URL_MIGRATE: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('user-service'),
  JWT_AUDIENCE: z.string().default('topos'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REDIS_URL: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  REDIS_SENTINEL_NAME: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  REDIS_SENTINELS: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  REDIS_PASSWORD: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  REDIS_SENTINEL_PASSWORD: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  REDIS_CACHE_TTL_MS: z.coerce.number().int().positive().default(3600000),
  REDIS_MISSING_CACHE_TTL_MS: z.coerce.number().int().positive().default(60000),
});

export const env = envSchema.parse(process.env);
