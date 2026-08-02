import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const migrateUrl = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: migrateUrl,
  },
});
