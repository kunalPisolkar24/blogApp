# Topos: Full-Stack Blogging Platform with AI Summaries

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Topos is a full-stack blogging platform: users sign up, write and tag posts,
and get AI-generated summaries, tags, and related-post recommendations — all
delivered through a GraphQL federation gateway in front of a polyglot
microservice architecture.

## Architecture

```
frontend (React + Vite)
   │  GraphQL
   ▼
gateway (Apollo Router :4000)
   │            │
   ▼            ▼
user           content ── gRPC (:50051) ──> ai
subgraph       subgraph                    (LLM summaries,
(:4001)        (:4002 + workers)            tags, posts,
TypeScript     Go 1.25                     vector search)
Apollo Fed.    gqlgen + Kafka
   │            │            │
Postgres      MongoDB      Qdrant
(+ replicas,  (sharded)    (vectors)
Pgpool-II)
```

- **gateway/** — Apollo Router composing the `user` and `content` subgraphs
  (`:4000/graphql`, health/metrics on `:8088`).
- **services/ai/** — Python 3.12 gRPC service (poetry): LLM summaries, tags,
  full posts, and hybrid (dense + sparse) vector search over Qdrant.
- **services/content/** — Go 1.25 GraphQL subgraph (gqlgen): posts and tags,
  plus Kafka workers for AI summary generation and Qdrant indexing, with a
  DLQ replay tool.
- **services/user/** — TypeScript (Node 22) Apollo Federation subgraph:
  accounts, profiles, JWTs, Prisma over Postgres (primary + replicas behind
  Pgpool-II) with a Redis sentinel cache.

## Repository layout

```
frontend/        React + Vite SPA (shadcn/ui, GraphQL codegen)
gateway/         Apollo Router configuration
services/ai/     Python gRPC service (LLM + vector search)
services/content/ Go GraphQL subgraph + Kafka workers
services/user/   TypeScript federation subgraph (accounts, profiles)
infrastructure/  Docker compose (prod/local), logging (filebeat/logstash)
```

## Getting started

Prerequisites: Docker with Docker Compose, plus the per-service toolchains
listed in each service's README (Python 3.12, Go 1.25, Node 22).

### Local stack

```bash
make local-up     # build and start all local containers
make local-logs   # tail logs
make local-down   # stop (keeps volumes)
make local-clean  # stop and delete volumes
```

Per-service local stacks are also available via `compose.local.yml` inside
each service directory (see the service READMEs).

### Production topology

```bash
cp infrastructure/docker/prod/.env.example .env   # fill in secrets
make up                                           # start the full prod stack
make down                                         # stop
```

### Running a single service

| Service | Quick start |
|---|---|
| `services/ai` | `poetry install && make run` |
| `services/content` | `go run ./cmd/server` |
| `services/user` | `npm ci && npm run dev` |
| `frontend` | `npm ci && npm run dev` (see `frontend/DESIGN.md`) |
| `gateway` | docker only (`make up` or `compose.yml`) |

Environment files come from `.env.example` in each service directory.

## Ports

| Service | Port(s) |
|---|---|
| Gateway (GraphQL) | 4000 |
| User subgraph | 4001 |
| Content subgraph / worker / search worker | 4002 / 4003 / 4004 |
| AI gRPC / metrics | 50051 / 12666 |
| Frontend (docker) / vite dev | 3000 / 5173 |

## Documentation

- **AGENTS.md** — guidance for AI agents: architecture, service matrix,
  commands, code style, and commit conventions.
- **CONTRIBUTING.md** — branch flow, commit rules, and verification steps.
- **Per-service READMEs** — `services/ai/README.md`,
  `services/content/README.md`, `services/user/README.md`,
  `frontend/DESIGN.md` — detailed setup, API, and layout for each service.

## License

This project is licensed under the MIT License. See the [LICENSE.md](LICENSE.md) file for details.