from prometheus_client import Counter, Gauge, Histogram

GRPC_REQUESTS = Counter(
    "grpc_requests_total",
    "Total number of gRPC requests",
    ["method", "status"],
)

GRPC_REQUEST_DURATION = Histogram(
    "grpc_request_duration_seconds",
    "Time spent processing gRPC requests",
    ["method", "status"],
)

GRPC_ACTIVE_REQUESTS = Gauge(
    "grpc_active_requests",
    "Number of requests currently being processed",
)

LLM_REQUESTS = Counter(
    "llm_requests_total",
    "Total number of LLM provider calls",
    ["status"],
)

LLM_REQUEST_DURATION = Histogram(
    "llm_request_duration_seconds",
    "Time spent waiting for the LLM provider",
)

LLM_RETRIES = Counter(
    "llm_retries_total",
    "Total number of retries of LLM provider calls",
)

EMBEDDING_REQUESTS = Counter(
    "embedding_requests_total",
    "Total number of embedding provider calls",
    ["status"],
)

EMBEDDING_REQUEST_DURATION = Histogram(
    "embedding_request_duration_seconds",
    "Time spent waiting for the embedding provider",
)
