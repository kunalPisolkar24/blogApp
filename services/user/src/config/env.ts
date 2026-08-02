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
});

export const env = envSchema.parse(process.env);
