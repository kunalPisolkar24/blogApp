# Content Service

GraphQL API for posts and tags (`content-service`) with two async workers
consuming post events from Kafka: `content-worker` (AI summaries) and
`content-search-worker` (vector indexing via the AI service). Go, gqlgen,
MongoDB, Redis, Kafka.

## Layout

- `cmd/` — service, worker, search worker and `dlq-replay` entrypoints
- `internal/` — config, cache, service, worker, dlq, middleware, metrics
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
- Search worker metrics: `http://localhost:4004/metrics`
- Requires the AI service and Qdrant, which compose.local.yml starts as
  `ai-service` and `qdrant` on the `app-network`

## Production HA stack

```sh
export JWT_SECRET=... MONGO_ROOT_PASSWORD=... MONGO_REPLICA_SET_KEY=... REDIS_PASSWORD=...
docker network create topos_prod_network   # once, unless it already exists
docker compose -f compose.yml up -d
```

Runs redis with sentinel (1 master, 1 replica, 3 sentinels, quorum 2),
MongoDB sharded (2 shards, 3 config servers, 2 mongos), and a 3-node Kafka
cluster (replication factor 3, min ISR 2). The service connects to redis
through sentinels and to both mongos; `posts` is sharded on a hashed `_id`
key.

`init-kafka` and `mongo-shard-init` run once on first start and create the
topics and the sharded collection. `mongo-shard-init` must finish before
the service boots, so the index setup matches the collection state (see
below). Verify the setup any time with `make verify-sharding`
(`MONGO_ROOT_PASSWORD` must be set).

Tear down with `docker compose -f compose.yml down -v`.

## MongoDB sharding & index design

- `posts` is sharded on `{_id: "hashed"}` — even write distribution and
  fast targeted `post(id)` lookups; `tags`, `chats` and `messages` stay
  unsharded on the primary shard.
- A unique index must start with the shard key on a sharded collection,
  so the `slug_unique` index cannot exist there. `EnsureIndexes` checks
  `config.collections` and creates it only when `posts` is unsharded
  (local dev); in the HA stack, slug uniqueness is enforced in-app by
  `PostService.ensureSlugAvailable` (see the slug retry design).
- `mongo-shard-init.sh` idempotently shards `blog_content.posts` and
  exits non-zero if sharding fails; `verify-sharding.sh` checks shard
  status, chunk distribution across both shards, and the absence of the
  unique slug index.
- Local vs HA matrix: local uses a single mongod (unique `slug` index
  enforced by the database); HA uses mongos (unique `slug` index absent,
  enforced in-app).

## Resilience

Workers retry failed messages up to 5 times with a 5s · attempt backoff,
then publish them to `KAFKA_DLQ_TOPIC` (`posts-dlq`) as
`DeadLetterMessage` envelopes. `cmd/dlq-replay` republishes dead letters
onto their original topic, resuming from committed offsets, so a second
run only replays what is still in the DLQ:

```sh
# runs inside the compose network (kafka-1:9092 is not reachable from the host)
docker run --network topos_local_network --env-file ../../infrastructure/docker/local/.env.local \
  content-content-worker ./content-dlq-replay
```

### Mongo startup retry

`db.Connect` fails fast on a malformed URI, but a transient ping failure
is retried with exponential backoff (1s, 2s, 4s, 8s, 16s, ~31s budget,
respecting shutdown cancellation), so a single boot-time blip does not
kill the process outside compose gating.

### Redis cache

The Redis cache is read-through and degrades gracefully: on any Redis
failure reads fall through to Mongo and writes always go to Mongo. To
make degradation observable instead of invisible, every swallowed Redis
error is logged at warn level and counted in
`content_cache_errors_total`; hits and misses are counted in
`content_cache_hits_total` / `content_cache_misses_total`.

Client timeouts and retries are explicit:

- `DialTimeout` 2s, `ReadTimeout`/`WriteTimeout` 3s
- 3 retries with 50ms–500ms backoff

Concurrent misses for the same key are coalesced (single-flight): a
burst of requests right after expiry or invalidation shares one fill
instead of stampeding Mongo or the AI service.

## Checks

```sh
make test               # unit tests (fast)
make test-integration   # integration tests (testcontainers: mongo, kafka,
                        # redis) — covers worker retries, poison -> DLQ and
                        # the replay round trip against real Kafka
make vet
make fmt
```

Load tests: see `load-tests/README.md` (`make load-test`, `make load-test-worker`, ...).
