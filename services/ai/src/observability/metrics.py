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

LLM_TOKENS = Counter(
    "llm_tokens_total",
    "Token usage reported by the LLM provider, estimated from char counts when omitted",
    ["method", "token_type"],
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

RECOMMEND_REQUESTS = Counter(
    "recommend_requests_total",
    "Total number of successful recommend feed calls",
    ["method", "status"],
)

RECOMMEND_REQUEST_DURATION = Histogram(
    "recommend_request_duration_seconds",
    "Time spent ranking a recommend feed",
    ["method", "status"],
)

PROFILE_UPDATES = Counter(
    "profile_updates_total",
    "Total number of successful user profile updates",
    ["kind"],
)

RECOMMEND_COLD_START = Counter(
    "recommend_cold_start_total",
    "Total number of recommend calls that returned an empty feed (cold start)",
)

RECOMMEND_COLD_START_RATIO = Gauge(
    "recommend_cold_start_ratio",
    "Share of recommend calls that returned an empty feed (cold start), 0-1",
)
