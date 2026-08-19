.PHONY: help build ensure-network up down logs restart clean prune \
       local-build local-up local-down local-logs local-restart local-clean \
       frontend-mock

ENV_FILE ?= .env
APP_NETWORK ?= topos_network
PROD_DIR      := infrastructure/docker/prod
PROD_COMPOSE  := $(PROD_DIR)/docker-compose.yml
COMPOSE ?= docker compose -f $(PROD_COMPOSE) --env-file $(ENV_FILE)

LOCAL_DIR      := infrastructure/docker/local
LOCAL_ENV_FILE := $(LOCAL_DIR)/.env.local
LOCAL_COMPOSE  := docker compose -f $(LOCAL_DIR)/docker-compose.local.yml --env-file $(LOCAL_ENV_FILE)

help:
	@echo "Available commands:"
	@echo ""
	@echo "  Production:"
	@echo "  make build    - Build all docker containers"
	@echo "  make ensure-network - Ensure the external docker network exists"
	@echo "  make up       - Start all services in the background"
	@echo "  make down     - Stop and remove all containers, networks"
	@echo "  make restart  - Restart all services"
	@echo "  make logs     - View logs from all services"
	@echo "  make clean    - Stop services and remove volumes"
	@echo "  make prune    - Prune completely out all unused docker resources"
	@echo ""
	@echo "  Local Development:"
	@echo "  make local-build   - Build all local containers"
	@echo "  make local-up      - Start local dev environment"
	@echo "  make local-down    - Stop local dev environment"
	@echo "  make local-restart - Restart local dev environment"
	@echo "  make local-logs    - View local dev logs"
	@echo "  make local-clean   - Stop local dev and remove volumes"
	@echo ""
	@echo "  Frontend:"
	@echo "  make frontend-mock - Run only the frontend with an in-memory mock backend"

build:
	$(COMPOSE) build

ensure-network:
	@network="$(APP_NETWORK)"; \
	if [ -f "$(ENV_FILE)" ]; then \
		env_network="$$(awk -F= '/^APP_NETWORK=/{print substr($$0, index($$0, "=")+1); exit}' "$(ENV_FILE)")"; \
		if [ -n "$$env_network" ]; then network="$$env_network"; fi; \
	fi; \
	docker network inspect "$$network" >/dev/null 2>&1 || \
		docker network create --driver bridge "$$network" >/dev/null

up: ensure-network
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(MAKE) down
	$(MAKE) up

logs:
	$(COMPOSE) logs -f

clean:
	$(COMPOSE) down -v

prune:
	docker system prune -a --volumes -f

# --- Local Development Targets ---

local-build:
	$(LOCAL_COMPOSE) build

local-up:
	$(LOCAL_COMPOSE) up -d

local-down:
	$(LOCAL_COMPOSE) down

local-restart:
	$(MAKE) local-down
	$(MAKE) local-up

local-logs:
	$(LOCAL_COMPOSE) logs -f

local-clean:
	$(LOCAL_COMPOSE) down -v

# --- Frontend ---

frontend-mock:
	cd frontend && npm run dev:mock
