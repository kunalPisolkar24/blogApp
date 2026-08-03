import { PrismaPg } from '@prisma/adapter-pg';
import { readReplicas } from '@prisma/extension-read-replicas';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

const primary = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: env.DATABASE_URL })),
});

const extended = env.DATABASE_URL_REPLICA
  ? primary.$extends(
      readReplicas({
        replicas: [
          new PrismaClient({
            adapter: new PrismaPg(
              new Pool({ connectionString: env.DATABASE_URL_REPLICA }),
            ),
          }),
        ],
      }),
    )
  : null;

export const prisma = (extended ?? primary) as PrismaClient;

export function primaryDb(): PrismaClient {
  return (extended ? extended.$primary() : primary) as PrismaClient;
}
