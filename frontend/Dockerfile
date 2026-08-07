FROM node:20-bookworm-slim AS deps

WORKDIR /app/frontend

COPY frontend/package*.json ./

RUN npm ci

FROM deps AS build

ARG VITE_GRAPHQL_URL
ARG VITE_BACKEND_URL
ARG VITE_CLOUDINARY_CLOUD_NAME
ARG VITE_CLOUDINARY_UPLOAD_PRESET

ENV VITE_GRAPHQL_URL=${VITE_GRAPHQL_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_CLOUDINARY_CLOUD_NAME=${VITE_CLOUDINARY_CLOUD_NAME}
ENV VITE_CLOUDINARY_UPLOAD_PRESET=${VITE_CLOUDINARY_UPLOAD_PRESET}

COPY frontend/ ./
COPY services/user/schema.graphql /app/services/user/schema.graphql
COPY services/content/graph/schema.graphqls /app/services/content/graph/schema.graphqls

RUN npm run build

FROM nginx:1.27-alpine AS runtime

ENV PORT=5173

COPY frontend/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 5173
