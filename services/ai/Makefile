.PHONY: install generate run test test-coverage lint format format-check clean docker-build docker-run docker-stop docker-logs integration integration-clean load-test load-test-build load-test-summary load-test-tags load-test-post load-test-search load-test-related load-test-recommend load-test-surprise load-test-chat load-test-stop load-test-clean load-test-tail

install:
	poetry install

generate:
	mkdir -p src/generated
	touch src/generated/__init__.py
	poetry run python -m grpc_tools.protoc -I proto/ai --python_out=src/generated --pyi_out=src/generated --grpc_python_out=src/generated ai_service.proto
	find src/generated -type f -name "*.py" -exec sed -i 's/^import ai_service_pb2/from . import ai_service_pb2/' {} +

run:
	poetry run python -m src.main

test:
	poetry run pytest -m "not container"

test-coverage:
	poetry run pytest -m "not container" --cov=src --cov-report=term-missing

# --- Container Integration Tests ---

integration:
	poetry run pytest tests/integration -v

integration-clean:
	docker image rm -f topos-ai:integration || true

lint:
	poetry run ruff check .

format:
	poetry run ruff format .

format-check:
	poetry run ruff format --check .

clean:
	rm -rf src/generated
	rm -rf .pytest_cache
	rm -f .coverage
	rm -rf htmlcov
	find . -type d -name "__pycache__" -exec rm -rf {} +

docker-build:
	docker build -t topos-ai .

docker-run:
	docker run -d --name topos-ai -p 50051:50051 -p 12666:12666 \
		-e LLM_API_KEY="$(LLM_API_KEY)" \
		-e LLM_API_URL="$(LLM_API_URL)" \
		-e LLM_MODEL="$(LLM_MODEL)" \
		-e METRICS_PORT="$(METRICS_PORT)" \
		-e OTEL_EXPORTER_OTLP_ENDPOINT="$(OTEL_EXPORTER_OTLP_ENDPOINT)" \
		topos-ai

docker-stop:
	docker rm -f topos-ai

docker-logs:
	docker logs -f topos-ai

# --- Load Test Targets ---

COMPOSE_LT := docker compose -f load-tests/compose.loadtest.yml --project-name topos-ai-loadtest

RPS       ?= 100
VUS       ?= 20
DURATION  ?= 30s
SCRIPT    ?= mixed
WEIGHTS   ?= summary:40,tags:30,post:30
LLM_MODE  ?= fake
LOG_LEVEL ?= WARNING
SVC_MEM   ?= 512M
K6_MEM    ?= 384M
EMBEDDING_MODE ?= fake
EMBEDDING_MODEL ?= snowflake-arctic-embed2:568m
OLLAMA_MEM ?= 2G
# Search/related RPCs hit the store per call; real embeddings (ollama)
# add their own latency, so the default latency budget widens for
# embedding-real runs. Both stay overridable from the command line.
SEARCH_P95 ?= $(if $(filter ollama,$(EMBEDDING_MODE)),2000,250)
SEARCH_P99 ?= $(if $(filter ollama,$(EMBEDDING_MODE)),4000,600)

# Recommend hits the store once per call like search, so it shares the
# plain budget; surprise relaxes its score threshold over many
# roundtrips, so its own budget widens for VECTOR_MODE=qdrant.
RECOMMEND_P95 ?= 250
RECOMMEND_P99 ?= 600
SURPRISE_P95 ?= $(if $(filter qdrant,$(VECTOR_MODE)),1000,250)
SURPRISE_P99 ?= $(if $(filter qdrant,$(VECTOR_MODE)),2000,600)

# Chat streams a full LLM answer per call, so budgets widen for real
# embeddings and again for a real LLM.
CHAT_P95 ?= $(if $(filter real,$(LLM_MODE)),15000,$(if $(filter ollama,$(EMBEDDING_MODE)),2000,500))
CHAT_P99 ?= $(if $(filter real,$(LLM_MODE)),30000,$(if $(filter ollama,$(EMBEDDING_MODE)),4000,1500))

# The ollama container is profile-gated so fake runs never pull the
# model; embedding-real runs start it first (see the load-test target).
LT_VARS = SCRIPT=$(SCRIPT) RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION) \
	WEIGHTS=$(WEIGHTS) LLM_MODE=$(LLM_MODE) LOG_LEVEL=$(LOG_LEVEL) \
	SVC_MEM=$(SVC_MEM) K6_MEM=$(K6_MEM) EMBEDDING_MODE=$(EMBEDDING_MODE) \
	EMBEDDING_MODEL=$(EMBEDDING_MODEL) OLLAMA_MEM=$(OLLAMA_MEM) \
	VECTOR_MODE=$(VECTOR_MODE) \
	LLM_API_KEY=$(LLM_API_KEY) \
	SEARCH_P95=$(SEARCH_P95) SEARCH_P99=$(SEARCH_P99) \
	RECOMMEND_P95=$(RECOMMEND_P95) RECOMMEND_P99=$(RECOMMEND_P99) \
	SURPRISE_P95=$(SURPRISE_P95) SURPRISE_P99=$(SURPRISE_P99) \
	CHAT_P95=$(CHAT_P95) CHAT_P99=$(CHAT_P99)

VALID_SCRIPTS := mixed generate-summary generate-tags generate-post generate-search generate-related generate-recommend generate-surprise generate-chat

load-test-build:
	$(LT_VARS) $(COMPOSE_LT) build

load-test: load-test-build
	@if echo " $(VALID_SCRIPTS) " | grep -q " $(SCRIPT) "; then :; else \
		echo "unknown SCRIPT=$(SCRIPT). valid: $(VALID_SCRIPTS)"; exit 2; \
	fi
	@if echo " fake ollama " | grep -q " $(EMBEDDING_MODE) "; then :; else \
		echo "unknown EMBEDDING_MODE=$(EMBEDDING_MODE). valid: fake ollama"; exit 2; \
	fi
	@if [ "$(EMBEDDING_MODE)" = "ollama" ]; then \
		$(LT_VARS) $(COMPOSE_LT) --profile embedding-real up -d --wait ollama; \
	fi
	$(LT_VARS) $(COMPOSE_LT) up -d --wait ai-service
	$(LT_VARS) $(COMPOSE_LT) run --rm k6
	@EXIT=$$?; \
	$(MAKE) --no-print-directory load-test-stop; \
	exit $$EXIT

load-test-summary: SCRIPT = generate-summary
load-test-summary: load-test

load-test-tags: SCRIPT = generate-tags
load-test-tags: load-test

load-test-post: SCRIPT = generate-post
load-test-post: load-test

load-test-search: SCRIPT = generate-search
load-test-search: load-test

load-test-related: SCRIPT = generate-related
load-test-related: load-test

load-test-recommend: SCRIPT = generate-recommend
load-test-recommend: load-test

load-test-surprise: SCRIPT = generate-surprise
load-test-surprise: load-test

load-test-chat: SCRIPT = generate-chat
load-test-chat: load-test

load-test-stop:
	$(LT_VARS) $(COMPOSE_LT) down -v --remove-orphans

load-test-clean: load-test-stop

load-test-tail:
	$(COMPOSE_LT) logs -f
