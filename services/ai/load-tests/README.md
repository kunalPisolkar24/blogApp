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
| `qdrant` | `qdrant/qdrant:v1.9.7` | Vector store for `IndexPost`/`SearchPosts` |
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
| `generate-search` | `IndexPost` (seed) + `SearchPosts` | seeds 7 posts in `setup()`, then searches; every 10th iteration is a gibberish query that must return 0 results (score threshold) |
| `mixed` (default) | all three | weighted mix, `WEIGHTS` env tunable |

## Tunables (Make env)

| Var | Default | Meaning |
|---|---|---|
| `RPS` | `100` | Aggregate target requests/sec |
| `VUS` | `20` | Pre-allocated VUs |
| `DURATION` | `30s` | Test wall clock |
| `SCRIPT` | `mixed` | One of the scenarios above |
| `WEIGHTS` | `summary:40,tags:30,post:30` | Only used by `mixed` |
| `LLM_MODE` | `fake` | Keep `fake` for local runs |
| `LOG_LEVEL` | `WARNING` | Quiet access logs during the run |
| `SVC_MEM` `QDRANT_MEM` `K6_MEM` | `512M` `256M` `384M` | Container memory caps |

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

# Post-heavy mix
make -C services/ai load-test WEIGHTS=post:70,summary:20,tags:10 DURATION=1m
```

## What k6 reports

- `grpc_req_duration` — built-in latency trend, thresholds p(95)<100ms, p(99)<250ms
- `summary_duration` / `tags_duration` / `post_duration` — per-RPC custom trends
- `checks` — every RPC must return gRPC status OK (0); `generate-search` also
  asserts relevant queries return results and gibberish returns none

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

All containers and volumes are removed.

## Lifecycle

1. `compose up` builds and starts `qdrant` (health check on `:6333`), then
   `ai-service` once qdrant is healthy; the service health check polls the gRPC
   health service for `ai.AIService` (SERVING)
2. `k6` starts once the service is healthy, loads the proto from
   `services/ai/proto/ai/ai_service.proto`, connects, and runs the scenario
3. k6 exits with non-zero on threshold breach; the Makefile propagates the code
4. `load-test-stop` tears down all containers and volumes
