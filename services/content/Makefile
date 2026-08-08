.PHONY: test test-integration coverage vet lint fmt
.PHONY: load-test load-test-worker load-test-reads load-test-writes load-test-build load-test-stop load-test-clean load-test-tail

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

# --- Load tests --------------------------------------------------------------
# Service profile: k6 -> content-service API (mongo + redis + kafka only, no worker).
# Worker profile: Go producer -> kafka -> content-worker; k6 scrapes worker metrics.

LOADTEST_DIR := load-tests
RPS ?= 50
VUS ?= 20
DURATION ?= 30s
SCRIPT ?= mixed
WEIGHTS ?= posts:30,post:20,tag:10,author:10,create:15,update:10,delete:5
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

load-test: load-test-build
	cd $(LOADTEST_DIR) && docker compose -f compose.loadtest.yml up -d --wait content-service
	cd $(LOADTEST_DIR) && docker compose -f compose.loadtest.yml run --rm \
		-e SCRIPT=$(SCRIPT) -e RPS=$(RPS) -e VUS=$(VUS) -e DURATION=$(DURATION) \
		-e WEIGHTS="$(WEIGHTS)" -e SEED_POST_COUNT=$(SEED_POST_COUNT) -e SEED_USERS=$(SEED_USERS) \
		k6
	$(MAKE) load-test-stop

load-test-worker: load-test-build
	@export RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION); \
	cd $(LOADTEST_DIR) && docker compose -f compose.worker-loadtest.yml up -d --wait content-worker content-search-worker && \
	docker compose -f compose.worker-loadtest.yml up -d producer && \
	docker compose -f compose.worker-loadtest.yml run --rm \
		-e RPS=$(RPS) -e VUS=$(VUS) -e DURATION=$(DURATION) \
		k6
	$(MAKE) load-test-stop

load-test-reads:
	$(MAKE) load-test SCRIPT=reads RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION)

load-test-writes:
	$(MAKE) load-test SCRIPT=writes RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION)

load-test-build:
	cd $(LOADTEST_DIR)/producer && go mod download
	cd $(LOADTEST_DIR) && docker compose -f compose.loadtest.yml build content-service
	cd $(LOADTEST_DIR) && docker compose -f compose.worker-loadtest.yml build content-worker content-search-worker producer

load-test-stop:
	cd $(LOADTEST_DIR) && docker compose -f compose.loadtest.yml down -v --remove-orphans
	cd $(LOADTEST_DIR) && docker compose -f compose.worker-loadtest.yml down -v --remove-orphans

load-test-clean:
	$(MAKE) load-test-stop
	docker rm -f loadtest-content-mongo loadtest-content-redis loadtest-content-kafka \
		loadtest-content-init-kafka loadtest-content-service loadtest-content-k6 \
		loadtest-worker-mongo loadtest-worker-redis loadtest-worker-kafka \
		loadtest-worker-init-kafka loadtest-worker-qdrant loadtest-worker-ai \
		loadtest-content-worker loadtest-content-search-worker loadtest-content-producer loadtest-worker-k6 2>/dev/null || true

load-test-tail:
	cd $(LOADTEST_DIR) && docker compose -f compose.loadtest.yml logs -f --tail=50
