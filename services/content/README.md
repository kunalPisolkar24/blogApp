# Content Service

GraphQL API for posts and tags (`content-service`) with an async summary
worker (`content-worker`) consuming post events from Kafka. Go, gqlgen,
MongoDB, Redis, Kafka.

## Layout

- `cmd/` — service and worker entrypoints
- `internal/` — config, cache, service, worker, middleware, metrics
- `graph/` — GraphQL schema and resolvers
- `infra/` — production HA compose includes (redis, mongo, kafka, shard init)
- `load-tests/` — k6 load tests (see its README)

## Local dev

```sh
cp .env.example .env
docker compose -f compose.local.yml up -d --build
```

- API: `http://localhost:4002` (GraphQL at `/query`, health at `/health`)
- Worker metrics: `http://localhost:4003/metrics`

## Production HA stack

```sh
export JWT_SECRET=... MONGO_ROOT_PASSWORD=... MONGO_REPLICA_SET_KEY=... REDIS_PASSWORD=...
docker network create topos_prod_network   # once, unless it already exists
docker compose -f compose.yml up -d
```

Runs redis with sentinel (1 master, 1 replica, 3 sentinels, quorum 2),
MongoDB sharded (2 shards, 3 config servers, 2 mongos), and a 3-node Kafka
cluster (replication factor 3, min ISR 2). The service connects to redis
through sentinels and to both mongos; `posts` is sharded on a hashed slug.

`init-kafka` and `mongo-shard-init` run once on first start and create the
topics and the sharded collection.

Tear down with `docker compose -f compose.yml down -v`.

## Checks

```sh
make test
make test-integration
make vet
make fmt
```

Load tests: see `load-tests/README.md` (`make load-test`, `make load-test-worker`, ...).
