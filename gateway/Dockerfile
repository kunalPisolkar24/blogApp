FROM debian:bullseye-slim AS composer

RUN apt-get update && apt-get install -y curl ca-certificates

RUN curl -sSL https://rover.apollo.dev/nix/latest | sh
ENV PATH="/root/.rover/bin:${PATH}"
ENV APOLLO_ELV2_LICENSE=accept

WORKDIR /app

COPY ./services/user/schema.graphql ./subgraphs/user.graphql
COPY ./services/content/graph/schema.graphqls ./subgraphs/content.graphql
COPY ./gateway/supergraph.yaml ./supergraph.yaml

RUN rover supergraph compose --config ./supergraph.yaml > supergraph.graphql

FROM ghcr.io/apollographql/router:v1.38.0

COPY ./gateway/router.yaml /dist/config/router.yaml
COPY --from=composer /app/supergraph.graphql /dist/schema/supergraph.graphql

ENV APOLLO_ROUTER_CONFIG_PATH="/dist/config/router.yaml"
ENV APOLLO_ROUTER_SUPERGRAPH_PATH="/dist/schema/supergraph.graphql"

CMD ["--config", "/dist/config/router.yaml", "--supergraph", "/dist/schema/supergraph.graphql"]
