# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.14.0

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /usr/src/app

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund

FROM deps AS builder
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL_MIGRATE="postgresql://dummy:dummy@localhost:5432/dummy" \
    npm run db:generate
COPY src ./src
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

FROM deps AS migrator
COPY prisma.config.ts ./
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ARG GIT_REVISION=unknown
LABEL org.opencontainers.image.title="topos-user" \
      org.opencontainers.image.source="https://github.com/kunalPisolkar24/topos" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache tini curl

WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=builder   --chown=node:node /usr/src/app/dist ./dist
COPY --from=builder   --chown=node:node /usr/src/app/src/generated/prisma ./src/generated/prisma
COPY --chown=node:node package.json ./

USER node
EXPOSE 4001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
