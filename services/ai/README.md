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

Set `VECTOR_MODE=fake` to swap Qdrant for a deterministic in-memory index
with the same semantics (dense cosine + sparse overlap, fused with RRF).
It needs no Qdrant at all — ideal for local dev and cheap load tests —
while `qdrant` (the default) is the real store. Both stores work with
either embedding mode.

`RelatedPosts` returns the nearest neighbours of an already-indexed post
by querying the store with the post's stored dense vector — no embedding
call at read time. Unknown post ids yield an empty result.

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

## Evaluation dataset

`scripts/build_eval_dataset.py` builds the chat evaluation dataset
(`topos-chat-eval`) used to measure how prompt or retrieval changes affect
citation quality. It merges a curated set (authored in
`scripts/eval_data.py`: ~50 questions with expected cited post ids, plus
gibberish and out-of-scope negatives) with optional real chat traces pulled
from LangSmith.

```bash
make eval-dataset-local   # write the local JSONL artifact only (no account needed)
make eval-dataset         # also upload to LangSmith when LANGSMITH_API_KEY is set
```

The local artifact (`eval_dataset.jsonl`) is reproducible with no LangSmith
account; example ids are deterministic, so re-running the upload is
idempotent. Set `LANGSMITH_PROJECT` to ingest real chat runs (best-effort:
runs that expose a query and cited post ids become examples). See issue #160.

`scripts/verify_eval_dataset.py` checks the curated corpus is actually
retrievable by the service (grounding validation). Bring up the service-level
stack first, then:

```bash
make eval-verify   # indexes the corpus and asserts expected posts are retrieved
```

This needs real embeddings, so run it against the `compose.local.yml` stack
(Qdrant + Ollama), not the fake-embedding path.

`scripts/verify_eval_chat.py` validates citations end-to-end via `ChatAnswer`
(`make eval-verify-chat`). With `AI_LLM_MODE=real` it checks the assistant
cites the expected posts for grounded rows and reports (without failing) any
negative rows it still cites.

### Recommender evals

`scripts/run_reco_evals.py` scores the personalized feed (`RecommendFeed`) in
DEFAULT and SURPRISE modes on precision@k against interaction-history topics,
tag diversity, and seen-ratio (recommended ≠ already seen). The dataset — a
fixed multi-topic corpus plus synthetic users with held-out interactions —
lives in `scripts/reco_eval_data.py`. Run against the service-level stack:

```bash
make eval-reco-baseline   # record reco_eval_baseline.json (gitignored)
make eval-reco            # re-run; exits non-zero on regression vs baseline
```

This is a local gate on purpose: run it before/after recommender changes. No
CI wiring. See issue #163.

## Observability

- **Metrics**: Prometheus endpoint on `:12666` — RPC counters/durations
  by method + status, active requests, LLM call metrics, and
  recommendation metrics (`recommend_requests_total` by mode + status,
  profile updates by kind, cold-start ratio).
- **Logs**: JSON lines to stdout (`service=ai`, `method`, `duration_ms`,
  `trace_id`/`span_id`) — ready for Loki.
- **Tracing**: optional OTLP export via `OTEL_EXPORTER_OTLP_ENDPOINT`.
