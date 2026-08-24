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
    ["status", "model"],
)

LLM_REQUEST_DURATION = Histogram(
    "llm_request_duration_seconds",
    "Time spent waiting for the LLM provider",
    ["model"],
)

LLM_RETRIES = Counter(
    "llm_retries_total",
    "Total number of retries of LLM provider calls",
)

LLM_TOKENS = Counter(
    "llm_tokens_total",
    "Token usage reported by the LLM provider, estimated from char counts when omitted",
    ["method", "token_type", "model"],
)

QUERY_REWRITES = Counter(
    "query_rewrites_total",
    "Outcomes of the chat graph's query rewrite node",
    ["outcome"],
)

CHAT_COMPACTS = Counter(
    "chat_compactions_total",
    "Times older chat turns were folded into a rolling summary",
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

SURPRISE_INTERACTIONS = Counter(
    "surprise_interactions_total",
    "Interactions attributed to a surprise feed, folded into profiles at the reduced weight",
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

FEED_AGENT_DECISIONS = Counter(
    "feed_agent_decisions_total",
    "Feed agent blend decisions: cache hits, fresh LLM picks, and fallbacks to balanced",
    ["outcome"],
)
