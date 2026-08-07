# AI Service

gRPC service that generates blog summaries, tags, and full posts via an
OpenAI-compatible LLM API (Lightning AI), and provides vector search over
posts backed by Qdrant (dense + sparse hybrid, with a score threshold).
Written in Python (3.12) with asyncio + grpcio, built for the rest of the
Topos platform over gRPC.

## RPCs

| RPC | Input | Output |
|---|---|---|
| `GenerateSummary` | `ContentRequest` | `ContentResponse` |
| `GenerateTags` | `ContextRequest` | `TagsResponse` |
| `GeneratePost` | `PostGenerationRequest` | `PostGenerationResponse` |
| `IndexPost` | `IndexRequest` | `IndexResponse` |
| `DeletePost` | `DeleteRequest` | `DeleteResponse` |
| `SearchPosts` | `SearchRequest` | `SearchResponse` |
| `RelatedPosts` | `RelatedRequest` | `RelatedResponse` |

## Layout

```
src/
├── main.py              # entrypoint: serve + graceful shutdown
├── config.py            # pydantic settings (env-driven)
├── llm.py               # LLM provider client (real + fake)
├── embeddings.py        # embedding clients (ollama + fake)
├── vector.py            # Qdrant index: upsert, delete, hybrid search, related
├── sparse.py            # sparse (lexical) tokenizer for hybrid search
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

Search requires a running Qdrant (`QDRANT_URL`, default
`http://localhost:6333`). Set `EMBEDDING_MODE=ollama` for real embeddings;
the default `fake` mode produces deterministic vectors (exact text matches
score ~1.0, unrelated text ~0.0). Unrelated results are filtered by
`SEARCH_DENSE_SCORE_THRESHOLD` (default `0.3`).

`RelatedPosts` returns the nearest neighbours of an already-indexed post
by querying Qdrant with the post's stored dense vector — no embedding call
at read time. Unknown post ids yield an empty result.

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
make integration     # container tests via testcontainers (builds the image;
                     # spins up Qdrant and covers search + threshold behavior)
make load-test       # k6 load tests against a fake-LLM container
make load-test-search   # k6 search load test (seeds posts, checks gibberish is filtered)
```

## Observability

- **Metrics**: Prometheus endpoint on `:12666` — RPC counters/durations
  by method + status, active requests, LLM call metrics.
- **Logs**: JSON lines to stdout (`service=ai`, `method`, `duration_ms`,
  `trace_id`/`span_id`) — ready for Loki.
- **Tracing**: optional OTLP export via `OTEL_EXPORTER_OTLP_ENDPOINT`.
