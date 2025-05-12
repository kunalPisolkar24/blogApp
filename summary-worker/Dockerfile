# ---- Base Node image for all stages ----
FROM node:18-alpine AS base
WORKDIR /usr/src/app

# ---- Dependencies Stage ----
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# ---- Build Stage ----
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Release Stage ----
FROM base AS release
ENV NODE_ENV=production
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

COPY .env.example ./.env.example

EXPOSE 8000
CMD [ "node", "dist/index.js" ]