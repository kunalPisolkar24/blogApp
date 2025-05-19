FROM node:18-alpine AS base
WORKDIR /usr/src/app

FROM base AS dependencies
COPY summary-worker/package.json summary-worker/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci --only=production

FROM base AS build
COPY summary-worker/package.json summary-worker/package-lock.json ./
RUN npm ci
COPY summary-worker/tsconfig.json ./
COPY summary-worker/src ./src
COPY backend/prisma ./prisma
RUN npx prisma generate
RUN npm run build

FROM base AS release
ENV NODE_ENV=production
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /usr/src/app/dist ./dist
COPY summary-worker/.env.example ./.env.example

EXPOSE 8000
# CMD [ "node", "dist/index.js" ]
CMD [ "tail", "-f", "/dev/null" ]