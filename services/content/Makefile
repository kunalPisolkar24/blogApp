.PHONY: test test-integration coverage vet lint fmt
.PHONY: verify-sharding
.PHONY: load-test load-test-worker load-test-reads load-test-writes load-test-chat load-test-build load-test-stop load-test-clean load-test-tail

# Excluded from the coverage report:
#   - generated code (gqlgen, protobuf): no hand-written logic
#   - db, repository: covered by the integration suite (testcontainers)
#   - bootstrap, cmd: entrypoint wiring only
#   - testutil: test doubles
GENERATED_RE := 'graph/generated.go|graph/model/|proto/ai/|\.pb\.go|internal/db/|internal/repository/|internal/bootstrap/|internal/testutil/|cmd/'

test:
	go test ./...

# -p 4 caps how many packages boot testcontainers at once; running every
# container-booting package in parallel starves docker and makes the
# kafka/mongo suites flaky under load.
test-integration:
	go test -tags integration -p 4 ./...

vet:
	go vet ./...
	go vet -tags integration ./...

fmt:
	gofmt -l .

coverage:
	go test ./... -coverprofile=/tmp/content-coverage.out
	grep -vE $(GENERATED_RE) /tmp/content-coverage.out > /tmp/content-coverage.filtered.out
	@go tool cover -func=/tmp/content-coverage.filtered.out | tail -1

# Runs the sharding verification inside the compose network against mongos.
# Requires MONGO_ROOT_PASSWORD and the HA stack to be up (make up in ../..).
verify-sharding:
	docker run --rm --network topos_prod_network \
		-e MONGO_ROOT_PASSWORD=$(MONGO_ROOT_PASSWORD) \
		-v $(CURDIR)/infra/scripts/verify-sharding.sh:/scripts/verify-sharding.sh:ro \
		mongo:7 /bin/sh /scripts/verify-sharding.sh

# --- Load tests --------------------------------------------------------------
# Service profile: k6 -> content-service API (mongo + redis + kafka + ai).
# Worker profile: Go producer -> kafka -> content-worker; k6 scrapes worker metrics.

LOADTEST_DIR := load-tests
COMPOSE_LT := docker compose -f $(LOADTEST_DIR)/compose.loadtest.yml --project-name topos-content-loadtest
RPS ?= 50
VUS ?= 20
DURATION ?= 30s
SCRIPT ?= mixed
WEIGHTS ?= posts:30,post:20,tag:10,author:10,create:15,update:10,delete:5,chat:5
SEED_POST_COUNT ?= 1000
SEED_USERS ?= 20
PARTITIONS ?= 3
JWT_SECRET ?= local-dev-secret
JWT_ISSUER ?= user-service
JWT_AUDIENCE ?= topos
MONGO_MEM ?= 768M
REDIS_MEM ?= 640M
SVC_MEM ?= 768M
K6_MEM ?= 384M
LLM_MODE ?= fake
LLM_API_KEY ?=
EMBEDDING_MODE ?= fake
EMBEDDING_MODEL ?= snowflake-arctic-embed2:568m
OLLAMA_MEM ?= 2G

# Chat streams a full LLM answer per call, so budgets widen for real
# embeddings and again for a real LLM.
CHAT_P95 ?= $(if $(filter real,$(LLM_MODE)),15000,$(if $(filter ollama,$(EMBEDDING_MODE)),2000,500))
CHAT_P99 ?= $(if $(filter real,$(LLM_MODE)),30000,$(if $(filter ollama,$(EMBEDDING_MODE)),4000,1500))

# The ollama container is profile-gated so fake runs never pull the
# model; embedding-real runs start it first (see the load-test target).
LT_VARS = RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION) SCRIPT=$(SCRIPT) \
	WEIGHTS=$(WEIGHTS) SEED_POST_COUNT=$(SEED_POST_COUNT) SEED_USERS=$(SEED_USERS) \
	PARTITIONS=$(PARTITIONS) JWT_SECRET=$(JWT_SECRET) \
	MONGO_MEM=$(MONGO_MEM) REDIS_MEM=$(REDIS_MEM) SVC_MEM=$(SVC_MEM) K6_MEM=$(K6_MEM) \
	LLM_MODE=$(LLM_MODE) LLM_API_KEY=$(LLM_API_KEY) EMBEDDING_MODE=$(EMBEDDING_MODE) \
	EMBEDDING_MODEL=$(EMBEDDING_MODEL) OLLAMA_MEM=$(OLLAMA_MEM) \
	CHAT_P95=$(CHAT_P95) CHAT_P99=$(CHAT_P99)

VALID_SCRIPTS := mixed reads writes chat

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
	$(LT_VARS) $(COMPOSE_LT) up -d --wait content-service
	$(LT_VARS) $(COMPOSE_LT) run --rm \
		-e SCRIPT=$(SCRIPT) -e RPS=$(RPS) -e VUS=$(VUS) -e DURATION=$(DURATION) \
		-e WEIGHTS="$(WEIGHTS)" -e SEED_POST_COUNT=$(SEED_POST_COUNT) -e SEED_USERS=$(SEED_USERS) \
		k6; \
	EXIT=$$?; \
	$(MAKE) --no-print-directory load-test-stop; \
	exit $$EXIT

load-test-worker: load-test-build
	@export RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION); \
	cd $(LOADTEST_DIR) && docker compose -f compose.worker-loadtest.yml up -d --wait content-worker content-search-worker && \
	docker compose -f compose.worker-loadtest.yml up -d producer && \
	docker compose -f compose.worker-loadtest.yml run --rm \
		-e RPS=$(RPS) -e VUS=$(VUS) -e DURATION=$(DURATION) \
		k6
	@EXIT=$$?; \
	$(MAKE) --no-print-directory load-test-stop; \
	exit $$EXIT

load-test-reads:
	$(MAKE) load-test SCRIPT=reads RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION)

load-test-writes:
	$(MAKE) load-test SCRIPT=writes RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION)

load-test-chat:
	$(MAKE) load-test SCRIPT=chat RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION) \
		LLM_MODE=$(LLM_MODE) EMBEDDING_MODE=$(EMBEDDING_MODE)

load-test-build:
	cd $(LOADTEST_DIR)/producer && go mod download
	$(LT_VARS) $(COMPOSE_LT) build content-service
	cd $(LOADTEST_DIR) && docker compose -f compose.worker-loadtest.yml build content-worker content-search-worker producer

load-test-stop:
	$(LT_VARS) $(COMPOSE_LT) down -v --remove-orphans
	cd $(LOADTEST_DIR) && docker compose -f compose.worker-loadtest.yml down -v --remove-orphans

load-test-clean:
	$(MAKE) load-test-stop
	docker rm -f loadtest-content-mongo loadtest-content-redis loadtest-content-kafka \
		loadtest-content-init-kafka loadtest-content-service loadtest-content-k6 \
		loadtest-content-qdrant loadtest-content-ai-service loadtest-content-ollama \
		loadtest-worker-mongo loadtest-worker-redis loadtest-worker-kafka \
		loadtest-worker-init-kafka loadtest-worker-qdrant loadtest-worker-ai \
		loadtest-content-worker loadtest-content-search-worker loadtest-content-producer loadtest-worker-k6 2>/dev/null || true

load-test-tail:
	cd $(LOADTEST_DIR) && docker compose -f compose.loadtest.yml logs -f --tail=50
