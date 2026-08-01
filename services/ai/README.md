# AI Service

gRPC service that generates blog summaries, tags, and full posts via an
OpenAI-compatible LLM API (Lightning AI). Written in Python (3.12) with
asyncio + grpcio, built for the rest of the Topos platform over gRPC.

## RPCs

| RPC | Input | Output |
|---|---|---|
| `GenerateSummary` | `ContentRequest` | `ContentResponse` |
| `GenerateTags` | `ContextRequest` | `TagsResponse` |
| `GeneratePost` | `PostGenerationRequest` | `PostGenerationResponse` |

## Layout

```
src/
├── main.py              # entrypoint: serve + graceful shutdown
├── config.py            # pydantic settings (env-driven)
├── llm.py               # LLM provider client (real + fake)
├── api/                 # gRPC server construction + RPC handlers
├── domain/              # models, prompts, sanitization, text cleaning
├── observability/       # logging, metrics, tracing
└── generated/           # generated protobuf stubs (gitignored, run make generate)
tests/
├── api/ domain/ observability/   # unit + in-process integration tests
└── integration/                  # container tests (testcontainers)
```

## Quick start

```bash
poetry install
make generate        # generate gRPC stubs (requires grpcio-tools)
make run             # starts on :50051, metrics on :12666
```

Requires `LLM_API_KEY` for real LLM calls; set `LLM_MODE=fake` to run
with canned responses and no network access.

## Docker

```bash
docker compose up -d --build
```

Runs the service as `ai-service` (resolvable by other services on the
`app-network`). See `.env.example` for all settings; the `AI_*` /
`LIGHTNING_AI_*` variables in the infra env files map to the service's
own env names.

## Testing

```bash
make test            # unit + in-process tests (fast, no docker)
make integration     # container tests via testcontainers (builds the image)
make load-test       # k6 load tests against a fake-LLM container
```

## Observability

- **Metrics**: Prometheus endpoint on `:12666` — RPC counters/durations
  by method + status, active requests, LLM call metrics.
- **Logs**: JSON lines to stdout (`service=ai`, `method`, `duration_ms`,
  `trace_id`/`span_id`) — ready for Loki.
- **Tracing**: optional OTLP export via `OTEL_EXPORTER_OTLP_ENDPOINT`.
