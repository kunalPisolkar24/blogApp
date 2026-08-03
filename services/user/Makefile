.PHONY: install build dev start db-generate db-migrate db-deploy \
        image image-migrator run

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
