# Content Service Load Tests

k6 load tests for the content service API and the content worker, run as two
independent Docker Compose rigs.

## Rigs

### Service profile (`compose.loadtest.yml`)

k6 exercises the GraphQL API (`content-service:4002`). Only the service's own
dependencies are running: Mongo, Redis and Kafka (no worker, no AI service).

- **Seed** — `setup()` mints `SEED_USERS` JWTs and creates `SEED_POST_COUNT`
  posts through the API, so read queries have a populated dataset. On the
  service, `generatePostContent`/`generateTags` fall back to the noop path
  because no AI service is running.
- **Scripts**
  - `mixed.js` — weighted mix of reads and writes (`WEIGHTS` variable)
  - `reads.js` — posts list, post by id, tags, author posts
  - `writes.js` — create/update/delete; writers only modify posts they created
- **JWT** — minted in k6 with `k6/crypto` HMAC-SHA256 using `JWT_SECRET`,
  matching the service's `JwtIssuer`/`JwtAudience` defaults.

### Worker profile (`compose.worker-loadtest.yml`)

A Go producer (`producer/`) publishes events to Kafka; the content worker and
the content search worker consume them, and k6 polls both workers' Prometheus
endpoints and asserts on consumer lag and result counters. Qdrant and the AI
service (fake LLM/embeddings, deterministic vectors) are part of the rig, so
the search worker indexes every event end to end. The producer writes synthetic
events that reference non-existent posts, so the content worker consumes and
skips them, plus one tombstone every 20 messages; keys are 24-hex post IDs so
the search worker can index them (the AI service requires hex point ids).

- `producer/` — standalone kafka-go producer, `main.go` + own `go.mod`.
- `worker.js` — scrapes both workers' `/metrics` and tracks
  `content_worker_consumer_lag` (reported every ~15s) and
  `content_worker_messages_total{result=...}`.
  `worker_skipped max>0` proves messages flowed end to end; `search_indexed
  max>0` proves the search worker indexed events; `search_dlq max<1` asserts
  no event was dead-lettered.

## Usage

```sh
make load-test            # service profile, default script (mixed)
make load-test-reads      # service profile, reads only
make load-test-writes     # service profile, writes only
make load-test-worker     # worker profile (producer + worker + k6)
```

Variables (defaults in brackets):

| Variable        | Default | Purpose                                   |
|-----------------|---------|-------------------------------------------|
| `RPS`           | 50      | arrival rate for k6 (and producer)        |
| `VUS`           | 20      | pre-allocated VUs                         |
| `DURATION`      | 30s     | run length                                |
| `SCRIPT`        | mixed   | k6 script (service profile)               |
| `WEIGHTS`       | see Makefile | operation mix for `mixed.js`        |
| `SEED_POST_COUNT` | 1000  | posts created in `setup()`                |
| `SEED_USERS`    | 20      | JWT identities used for seeding and writes |
| `PARTITIONS`    | 3       | partitions for the `posts` topic          |
| `SEARCH_WORKER_CONCURRENCY` | 3 | readers for the content search worker  |
| `JWT_SECRET`    | local-dev-secret | secret used for minting JWTs      |
| `MONGO_MEM`/`REDIS_MEM`/`SVC_MEM`/`QDRANT_MEM`/`K6_MEM` | 768M/640M/768M/256M/192M | memory limits |

Examples:

```sh
make load-test RPS=100 DURATION=2m WEIGHTS=posts:40,post:20,tag:10,author:10,create:10,update:5,delete:5
make load-test-reads RPS=200 DURATION=1m SEED_POST_COUNT=5000
make load-test-worker RPS=200 DURATION=2m PARTITIONS=6 VUS=10
```

Cleanup: `make load-test-clean` (down + remove containers), `make load-test-stop`
(down only), `make load-test-tail` (follow service logs).

## Thresholds

Service profile: read `p(95)<300ms` / `p(99)<800ms`, write `p(95)<500ms` /
`p(99)<1200ms`, error rate `<1%` (grouped via request tags).

Worker profile: lag `p(95)<500` for both workers, no failed messages,
`worker_skipped max>0`, `search_indexed max>0`, `search_dlq max<1`, scrape
error rate `<1%`. Tune `worker_lag` if the worker is expected to lag behind a
high producer rate.
