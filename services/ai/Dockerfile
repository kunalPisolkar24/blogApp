# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS codegen

WORKDIR /gen

COPY proto/ai/ai_service.proto ./proto/ai/

RUN pip install --no-cache-dir grpcio-tools

RUN mkdir -p src/generated && touch src/generated/__init__.py && \
    python -m grpc_tools.protoc -I proto/ai --python_out=src/generated --grpc_python_out=src/generated ai_service.proto && \
    find src/generated -type f -name "*.py" -exec sed -i 's/^import ai_service_pb2/from . import ai_service_pb2/' {} +

FROM python:3.12-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir poetry

COPY pyproject.toml poetry.lock ./

RUN poetry config virtualenvs.in-project true && \
    poetry install --no-root --without dev --no-interaction

COPY src ./src
COPY --from=codegen /gen/src/generated ./src/generated

FROM python:3.12-slim AS runtime

ARG GIT_REVISION=unknown

LABEL org.opencontainers.image.title="topos-ai" \
      org.opencontainers.image.source="https://github.com/kunalPisolkar24/topos" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PATH="/app/.venv/bin:${PATH}"

RUN groupadd -r appuser && useradd -r -g appuser appuser

COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --from=builder --chown=appuser:appuser /app/src /app/src

USER appuser

EXPOSE 50051 12666

CMD ["python", "-m", "src.main"]
