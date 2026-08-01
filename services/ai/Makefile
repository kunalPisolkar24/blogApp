.PHONY: install generate run test test-coverage lint format format-check clean docker-build docker-run docker-stop docker-logs

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
	poetry run pytest

test-coverage:
	poetry run pytest --cov=src --cov-report=term-missing

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
