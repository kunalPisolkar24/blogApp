# AGENTS.md

Guidance for AI agents and humans working in this repository. Read this file
before making changes.

## Project overview

Topos is a full-stack blogging platform: users sign up, write posts, tag
them, and get AI-generated summaries, tags, and related-post recommendations.
It is a monorepo with four services, a GraphQL gateway, and a frontend.

```
frontend/       React + Vite SPA (shadcn/ui, GraphQL codegen)
gateway/        Apollo Router (GraphQL federation gateway)
services/
  ai/           Python 3.12 gRPC service: LLM summaries, tags, posts,
                vector search over Qdrant (dense + sparse hybrid)
  content/      Go 1.25 GraphQL subgraph + Kafka workers: posts, tags,
                AI summary/vector indexing, DLQ replay
  user/         TypeScript (Node 22) Apollo Federation subgraph: accounts,
                profiles, JWTs, Prisma over Postgres
infrastructure/ Docker compose (prod/local), logging (filebeat/logstash)
```

## Architecture

- **GraphQL federation:** the frontend talks only to the gateway (Apollo
  Router, `:4000/graphql`), which composes the `user` and `content`
  subgraphs.
- **gRPC:** `content` calls `ai` over gRPC (`:50051`) for summaries, tags,
  posts, vector indexing, search, and related posts. The shared proto is
  `services/ai/proto/ai/ai_service.proto`; `content` keeps a generated Go
  copy under `services/content/proto/ai/`.
- **Storage:**
  - Postgres (primary + 2 replicas behind Pgpool-II) — `user`
  - MongoDB (sharded) — `content`
  - Redis — cache in `content`, sentinel-backed cache in `user`
  - Qdrant — vectors in `ai`
  - Kafka — `content` events: `posts`, `posts-dlq`, `user-interacted`
- **Async work:** `content-service` publishes post events to Kafka;
  `content-worker` generates AI summaries; `content-search-worker` indexes
  posts into Qdrant via `ai`.

## Service matrix

| Service | Stack | Entrypoint | Ports | Run | Unit tests | Integration tests | Lint / format | Codegen |
|---|---|---|---|---|---|---|---|---|
| `services/ai` | Python 3.12, poetry, gRPC | `src/main.py` | gRPC 50051, metrics 12666 | `make run` | `make test` (pytest, skips container tests) | `make integration` (testcontainers) | `make lint` (ruff check), `make format` (ruff format) | `make generate` (protoc → `src/generated/`, gitignored) |
| `services/content` | Go 1.25, gqlgen, gRPC client | `cmd/server`, `cmd/worker`, `cmd/search-worker`, `cmd/dlq-replay` | server 4002 (`/query`, `/health`), worker 4003, search worker 4004 | `go run ./cmd/server` | `make test` (`go test ./...`) | `make test-integration` (`go test -tags integration -p 4`, testcontainers) | `make vet` (`go vet ./...`), `make fmt` (`gofmt -l .`) | `make generate` (protoc → `proto/ai/`, gqlgen) |
| `services/user` | TypeScript Node 22, Apollo Federation subgraph, Prisma | `src/index.ts` | 4001 | `npm run dev` | `npm test` (vitest) | `npm run test:integration` (testcontainers) | `npm run lint` (`tsc --noEmit && eslint .`) | `npx prisma generate` |
| `frontend` | React + Vite, shadcn/ui, Tailwind, GraphQL codegen | `src/main.tsx` | dev 5173, docker 3000 | `npm run dev` | `npm test` (vitest) | `npm run test:integration` | `npm run lint` (eslint) | `npm run codegen` (graphql-codegen) |
| `gateway` | Apollo Router | `router.yaml`, `supergraph.yaml` | graphql 4000, health/metrics 8088 | docker only (see `compose.yml`) | — | — | — | — |

Run verification in the service directory before pushing (see
[CONTRIBUTING.md](CONTRIBUTING.md)).

## Development workflow

- **Branches:** create `feat/*`, `fix/*`, or `chore/*` branches off `dev`.
  Keep branches small and focused on one change.
- **Pull requests:** target `dev`. A PR template is enforced
  (`.github/PULL_REQUEST_TEMPLATE.md`).
- **CI:** per-service GitHub Actions workflows
  (`.github/workflows/service-*.yaml`) run tests and lint on PRs and pushes
  to `main`/`staging`; they also build and push Docker images.
- **Local stacks:** root `make local-up` / `make local-down` or per-service
  `compose.local.yml` files. Prod topology is `make up` / `make down` with
  `infrastructure/docker/prod/`. Environment files come from the
  `.env.example` in each service dir (plus
  `infrastructure/docker/prod/.env.example` for the prod stack).

### Commits

One-line commit messages, no conventional-commit prefix, imperative mood,
under ~72 characters.

Good:

```
Add recommendation RPCs to the ai proto
Fix pagination cursor validation in content service
```

Avoid:

```
feat(ai): add recommendation RPCs
fix: pagination bug
```

## Code style

Write clean, simple, readable, maintainable code. Rules for every change:

- **Simple over clever.** No over-engineering, premature abstraction, or
  speculative features. If a loop is clearer than a one-liner, use the loop.
- **Match existing idioms.** Follow the layout, naming, and patterns of the
  service you touch (see the README in each service dir). Keep the diff
  small and focused on the task.
- **Readable first.** Clear names, single responsibility per function/type,
  obvious control flow. No comments that restate the code; comment only
  non-obvious reasoning.
- **No dead code.** Delete unused code, imports, and config when you see it.
- **Tests for new behavior.** Add unit tests; add integration tests when the
  change touches DB, Kafka, Redis, or Qdrant (they need Docker).
- **Pass the linters.** Each service has lint/format commands in the matrix
  above; run them before finishing.

## Codegen

Generated code is gitignored in `services/ai/src/generated/` and
`services/user/src/generated/` and must be regenerated, not edited:

- **Proto changes** (`services/ai/proto/ai/ai_service.proto`): run
  `make generate` in `services/ai` (Python stubs) **and** in
  `services/content` (Go stubs). Keep both in sync.
- **Prisma schema** (`services/user/prisma/schema.prisma`): run
  `npx prisma generate`.
- **GraphQL schema changes** in `frontend` or `services/content/graph`:
  run `npm run codegen` in `frontend` / gqlgen in `content` as needed.

## Testing conventions

- Unit tests are fast and need no Docker. Integration tests use
  testcontainers and need Docker running.
- `ai` splits tests by pytest marker: `make test` skips `container`-marked
  tests; `make integration` runs `tests/integration/`.
- `content` excludes generated code, db, repositories, bootstrap, cmd, and
  testutil from coverage (see the `GENERATED_RE` in its Makefile).
- Fake modes keep tests hermetic: `LLM_MODE=fake`, `EMBEDDING_MODE=fake`,
  `VECTOR_MODE=fake` (ai). Load tests use the same flags (see `make
  load-test*` targets in each service Makefile).