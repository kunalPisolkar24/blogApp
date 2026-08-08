# AI Service Load Tests (k6)

Self-contained load test rig for the AI service. Everything runs in Docker
containers on a private `ai-loadtest-net` network — no host installs, no k6
binary needed, no port collisions.

The service runs with `LLM_MODE=fake`, so **no real LLM calls are made**:
`FakeLLMClient` returns canned, valid responses instantly. The test measures
the service's own capacity — gRPC handling, size validation, HTML cleaning,
JSON parsing, pydantic validation, and sanitization.

## Stack

| Container | Image | Purpose |
|---|---|---|
| `ai-service` | service `Dockerfile` | System under test, fake LLM mode |
| `qdrant` | `qdrant/qdrant:v1.19.0` | Vector store for `IndexPost`/`SearchPosts`/`RelatedPosts` |
| `ollama` (embedding-real only) | `ollama/ollama` | Real embedding provider for `EMBEDDING_MODE=ollama`; profile-gated so fake runs never pull the model |
| `k6` | `grafana/k6:latest` | Load driver (gRPC via the checked-in proto) |

## Quick start

```bash
# from repo root
make -C services/ai load-test RPS=10 VUS=5 DURATION=10s

# or with defaults (mixed scenario, 100 RPS, 20 VUs, 30s)
make -C services/ai load-test
```

k6 prints its standard end-of-run summary. The exit code propagates:
threshold failures cause the Make target to fail.

## Scenarios

| `SCRIPT=` | RPC | Notes |
|---|---|---|
| `generate-summary` | `GenerateSummary` | ~1.3KB text per call |
| `generate-tags` | `GenerateTags` | title + ~1.2KB body (truncated at 3000) |
| `generate-post` | `GeneratePost` | ~400-char prompt, full JSON parse + sanitize |
| `generate-search` | `IndexPost` (seed) + `SearchPosts` | seeds 7 posts in `setup()`, then searches; every 10th iteration is a gibberish query that must return 0 results (score threshold — only asserted with fake embeddings; a real model may find weak similarity) |
| `generate-related` | `IndexPost` (seed) + `RelatedPosts` | seeds 6 posts plus an identical-text twin each, so every post has a guaranteed nearest neighbour; asserts results, twin on top, self excluded |
| `mixed` (default) | all three | weighted mix, `WEIGHTS` env tunable |

## Store and embedding modes

Search and related run against one of two stores, and embeddings can be
deterministic or real — the scripts are identical either way.

| Var | Value | Behavior |
|---|---|---|
| `VECTOR_MODE=fake` | default `qdrant` | In-memory index inside the service; deterministic (exact text matches score ~1.0, unrelated ~0.0). No store roundtrip, so latencies are service-bound. The `qdrant` container still runs but is unused |
| `VECTOR_MODE=qdrant` | default | Real Qdrant roundtrip per search/related call |
| `EMBEDDING_MODE=fake` | default | Deterministic unit-norm vectors; quality checks (gibberish filtered, twins on top) are exact |
| `EMBEDDING_MODE=ollama` | default `fake` | Real model (`snowflake-arctic-embed2:568m`) via the profile-gated `ollama` container; the first run pulls the model. Checks are best-effort (semantic scores vary) and latency budgets default wider (`SEARCH_P95=2000`, `SEARCH_P99=4000`) |

The LLM is never in the search/related path, so `LLM_MODE` only matters
for the `generate-*` LLM scenarios.

## Tunables (Make env)

| Var | Default | Meaning |
|---|---|---|
| `RPS` | `100` | Aggregate target requests/sec |
| `VUS` | `20` | Pre-allocated VUs |
| `DURATION` | `30s` | Test wall clock |
| `SCRIPT` | `mixed` | One of the scenarios above |
| `WEIGHTS` | `summary:40,tags:30,post:30` | Only used by `mixed` |
| `LLM_MODE` | `fake` | Keep `fake` for local runs |
| `VECTOR_MODE` | `qdrant` | `fake` = in-memory index, `qdrant` = real store |
| `EMBEDDING_MODE` | `fake` | `fake` = deterministic, `ollama` = real model (starts the `ollama` container) |
| `EMBEDDING_MODEL` | `snowflake-arctic-embed2:568m` | Model used by the `ollama` container |
| `SEARCH_P95` `SEARCH_P99` | `250`/`600` | Search/related latency budgets; auto-widened to `2000`/`4000` for embedding-real runs, still overridable |
| `LOG_LEVEL` | `WARNING` | Quiet access logs during the run |
| `SVC_MEM` `QDRANT_MEM` `OLLAMA_MEM` `K6_MEM` | `512M` `256M` `2G` `384M` | Container memory caps |

## Common invocations

```bash
# Smoke test, 10s
make -C services/ai load-test RPS=10 VUS=5 DURATION=10s

# Steady state, 2 min
make -C services/ai load-test RPS=100 VUS=20 DURATION=2m

# Find the ceiling: each endpoint at 500 RPS
make -C services/ai load-test-summary RPS=500 VUS=100 DURATION=1m
make -C services/ai load-test-tags RPS=500 VUS=100 DURATION=1m
make -C services/ai load-test-post RPS=500 VUS=100 DURATION=1m

# Search and related: fake store (no qdrant roundtrip) or real store
make -C services/ai load-test-search VECTOR_MODE=fake RPS=200 DURATION=1m
make -C services/ai load-test-related RPS=200 DURATION=1m
make -C services/ai load-test-related VECTOR_MODE=fake RPS=200 DURATION=1m

# Real embeddings (first run pulls the model, ~1GB)
make -C services/ai load-test-related EMBEDDING_MODE=ollama RPS=20 DURATION=1m
make -C services/ai load-test-search EMBEDDING_MODE=ollama SEARCH_P95=3000 RPS=20 DURATION=1m

# Post-heavy mix
make -C services/ai load-test WEIGHTS=post:70,summary:20,tags:10 DURATION=1m
```

## What k6 reports

- `grpc_req_duration` — built-in latency trend, thresholds p(95)<100ms, p(99)<250ms
  (search/related widen and tune theirs via `SEARCH_P95`/`SEARCH_P99`)
- `summary_duration` / `tags_duration` / `post_duration` — per-RPC custom trends
- `checks` — every RPC must return gRPC status OK (0); `generate-search` also
  asserts relevant queries return results and gibberish returns none
  (gibberish only binds with fake embeddings, see "Store and embedding modes");
  `generate-related` asserts every post finds its twin and never itself

## Inspecting state

```bash
# During a run, in another terminal:
docker compose -p topos-ai-loadtest logs -f ai-service

# Service metrics live on :12666 inside the container (not published to the host):
docker compose -p topos-ai-loadtest exec ai-service \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:12666/metrics').read()[:600])"
```

## Cleanup

```bash
make -C services/ai load-test-stop
make -C services/ai load-test-clean   # alias
```

All containers and volumes are removed (including the ollama model
cache, so an embedding-real run re-pulls the model).

## Lifecycle

1. `compose up` builds and starts `qdrant` (health check on `:6333`), then
   `ai-service` once qdrant is healthy; the service health check polls the gRPC
   health service for `ai.AIService` (SERVING)
2. For `EMBEDDING_MODE=ollama`, the Makefile first starts `ollama` with the
   `embedding-real` profile and waits for the model healthcheck
3. `k6` starts once the service is healthy, loads the proto from
   `services/ai/proto/ai/ai_service.proto`, connects, and runs the scenario
4. k6 exits with non-zero on threshold breach; the Makefile propagates the code
5. `load-test-stop` tears down all containers and volumes
