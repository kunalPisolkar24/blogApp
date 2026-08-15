import { PrismaPg } from '@prisma/adapter-pg';
import { readReplicas } from '@prisma/extension-read-replicas';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

export const primaryPool = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

const primary = new PrismaClient({
  adapter: new PrismaPg(primaryPool),
});

export const replicaPool = env.DATABASE_URL_REPLICA
  ? new Pool({
      connectionString: env.DATABASE_URL_REPLICA,
      connectionTimeoutMillis: 5000,
    })
  : null;

const extended = replicaPool
  ? primary.$extends(
      readReplicas({
        replicas: [
          new PrismaClient({
            adapter: new PrismaPg(replicaPool),
          }),
        ],
      }),
    )
  : null;

export const prisma = (extended ?? primary) as PrismaClient;

export function primaryDb(): PrismaClient {
  return (extended ? extended.$primary() : primary) as PrismaClient;
}

export async function closeDb(): Promise<void> {
  await Promise.allSettled([prisma.$disconnect(), primaryDb().$disconnect()]);
}

export async function pingDb(): Promise<'ok' | 'unavailable'> {
  try {
    await Promise.race([
      primaryPool.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('db ping timed out')), 3000),
      ),
    ]);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}