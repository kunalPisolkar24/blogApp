.PHONY: install build dev start db-generate db-migrate db-deploy \
        image image-migrator run \
        load-test-build load-test load-test-signup load-test-signin \
        load-test-me load-test-users load-test-update-profile \
        load-test-cold load-test-stop load-test-clean load-test-tail

NODE_VERSION ?= 22.14.0
IMAGE       ?= topos-user
TAG         ?= latest

install:
	npm ci

build:
	npm run build

dev:
	npm run dev

start:
	npm start

db-generate:
	npx prisma generate

db-migrate:
	npx prisma migrate dev

db-deploy:
	npx prisma migrate deploy

image:
	docker build --build-arg NODE_VERSION=$(NODE_VERSION) -t $(IMAGE):$(TAG) .

image-migrator:
	docker build --target migrator --build-arg NODE_VERSION=$(NODE_VERSION) -t $(IMAGE)-migrator:$(TAG) .

run:
	docker run --rm -p 4001:4001 --env-file .env $(IMAGE):$(TAG)

# --- Load Tests ---

COMPOSE_LT := docker compose -f load-tests/compose.loadtest.yml --project-name topos-user-loadtest

RPS             ?= 50
VUS             ?= 20
DURATION        ?= 30s
SCRIPT          ?= mixed
WEIGHTS         ?= users:30,user:15,me:20,signin:20,updateProfile:10,signup:5
SEED_USERS      ?= 100
USER_JWT_SECRET ?= loadtest-jwt-secret-0123456789abcdef

PG_MEM    ?= 512M
REDIS_MEM ?= 256M
SVC_MEM   ?= 512M
K6_MEM    ?= 384M

LT_VARS := SCRIPT=$(SCRIPT) RPS=$(RPS) VUS=$(VUS) DURATION=$(DURATION) \
	WEIGHTS=$(WEIGHTS) SEED_USERS=$(SEED_USERS) USER_JWT_SECRET=$(USER_JWT_SECRET) \
	PG_MEM=$(PG_MEM) REDIS_MEM=$(REDIS_MEM) SVC_MEM=$(SVC_MEM) K6_MEM=$(K6_MEM)

VALID_SCRIPTS := mixed signup signin me users update-profile

load-test-build:
	$(LT_VARS) $(COMPOSE_LT) build

load-test: load-test-build
	@if echo " $(VALID_SCRIPTS) " | grep -q " $(SCRIPT) "; then :; else \
		echo "unknown SCRIPT=$(SCRIPT). valid: $(VALID_SCRIPTS)"; exit 2; \
	fi
	$(LT_VARS) $(COMPOSE_LT) up -d --wait user-service
	$(LT_VARS) $(COMPOSE_LT) run --rm k6
	@EXIT=$$?; \
	$(MAKE) --no-print-directory load-test-stop; \
	exit $$EXIT

load-test-cold: load-test-build
	@if echo " $(VALID_SCRIPTS) " | grep -q " $(SCRIPT) "; then :; else \
		echo "unknown SCRIPT=$(SCRIPT). valid: $(VALID_SCRIPTS)"; exit 2; \
	fi
	$(LT_VARS) $(COMPOSE_LT) up -d --wait user-service
	@echo "[cold] flushing redis cache"
	$(LT_VARS) $(COMPOSE_LT) exec -T user-redis redis-cli FLUSHALL
	$(LT_VARS) $(COMPOSE_LT) run --rm k6
	@EXIT=$$?; \
	$(MAKE) --no-print-directory load-test-stop; \
	exit $$EXIT

load-test-signup: SCRIPT = signup
load-test-signup: load-test

load-test-signin: SCRIPT = signin
load-test-signin: load-test

load-test-me: SCRIPT = me
load-test-me: load-test

load-test-users: SCRIPT = users
load-test-users: load-test

load-test-update-profile: SCRIPT = update-profile
load-test-update-profile: load-test

load-test-stop:
	$(LT_VARS) $(COMPOSE_LT) down -v --remove-orphans

load-test-clean: load-test-stop

load-test-tail:
	$(COMPOSE_LT) logs -f
