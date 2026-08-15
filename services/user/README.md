# User Service

GraphQL (Apollo Federation subgraph) service for the Topos platform: account
signup/signin and user profiles. Written in TypeScript (Node 22) with Prisma
over Postgres — a primary + 2 replicas fronted by a Pgpool-II pool — and a
Redis sentinel cache.

## API

| Operation | Description |
|---|---|
| `signup(email, username, password)` | create account → `AuthPayload` (JWT + user) |
| `signin(email, password)` | verify credentials → `AuthPayload` |
| `updateProfile(name, bio, ...)` | update the signed-in user's profile |
| `me` | the signed-in user |
| `user(id)` | user by id |
| `users(limit, cursor)` | paginated user directory |

`User` is a federated entity (`@key(id)`), resolvable by other subgraphs.

## Layout

```
src/
├── index.ts / app.ts     # entrypoint, Hono server, health + metrics routes
├── config/               # zod-validated env
├── graphql/              # typeDefs + resolvers (federation subgraph)
├── domain/               # user model, password hashing
├── repositories/         # Prisma data access
├── lib/                  # prisma, redis (sentinel), cache, shutdown
├── observability/        # logging, metrics, tracing
├── utils/                # token (JWT) helpers
├── integration/          # container tests (testcontainers)
└── generated/            # prisma client (generated, gitignored)
```

## Quick start

```bash
docker compose -f compose.local.yml up -d --build
```

Starts a single Postgres + Redis + migrator + the service on `:4001` with
defaults — no env file needed (equivalent to `make local-up`). For bare-metal
dev: `npm ci`, copy the user block from
`infrastructure/docker/prod/.env.example` into `.env`, then `npm run dev`.

## Running the stacks

The service can run in three standalone modes, all scoped to `services/user`:

### 1. Local stack (single Postgres + Redis + service) — `compose.local.yml`

```bash
make local-up     # builds and starts postgres + redis + migrator + service
make local-logs   # tail the logs
make local-down   # stop (keeps volumes)
make local-clean  # stop and delete volumes
```

No env file needed — defaults come from `compose.local.yml`. The service is on
`:4001`; Postgres `:5432` (external port `USER_POSTGRES_EXT_PORT`), Redis
`:6380`.

### 2. Standalone HA stack (Postgres tripod + Pgpool-II + Redis sentinels) — `compose.yml`

```bash
cp .env.ha.example .env.ha   # then fill in the <password> placeholders
make ha-up                   # creates the network, builds, starts, migrates
make ha-logs
make ha-down                 # stops and deletes volumes + network
make ha-clean                # alias for ha-down
```

Prod-identical topology with prod host ports (`4001`, `5432`): the app talks
only to the pool, migrations run against the primary directly. Uses the
dedicated `topos-user-ha` network and `userha-*` container names so it never
clashes with a root-level prod stack.

### 3. HA failover drill (semi-manual) — `.env.ha-test`

`make ha-test-up` / `ha-test-stop` exercise the failover/rejoin flow against
the same compose files (see `.env.ha-test.example`).

> Local and HA stacks are exclusive by design (same host ports) — run only
> one at a time.

## Docker

`compose.yml` is the production topology and includes `infra/postgres.yml`
(primary + replicas + pool) and `infra/redis.yml` (sentinel trio) via compose
`include`. Env comes from `infrastructure/docker/prod/.env.example` at the
repo root.

- The app talks **only to the pool** (`user-postgres-pool:5432`) — it fronts
  the tripod and promotes a replica automatically on primary failure.
- Migrations (`user-migrator`) run against the **primary directly**
  (`DATABASE_URL_MIGRATE`): through the pool, Prisma's persistence checks can
  land on a replica that has not caught up yet.
- `make ha-test-up` / `ha-test-stop` drill the full failover/rejoin flow
  against the same compose files (see `.env.ha-test.example`).

## Testing

```bash
npm test                  # unit tests (fast, no docker)
npm run test:integration  # container tests via testcontainers (needs Node 22)
npm run test:coverage     # unit tests with 85% coverage thresholds
make load-test            # k6 load tests against a compose stack
```

## Observability

- **Metrics**: Prometheus endpoint on `/metrics` — request and GraphQL
  counters/durations by operation + status, cache operations/invalidations.
- **Logs**: JSON lines to stdout (`service=user-service`, `operation`,
  `duration_ms`, `trace_id`/`span_id`) — ready for Loki.
- **Tracing**: optional OTLP export via `OTEL_EXPORTER_OTLP_ENDPOINT`.
