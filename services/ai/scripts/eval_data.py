"""Curated evaluation dataset for the Topos grounded chat assistant.

This module is the source of truth for ``scripts/build_eval_dataset.py``.
It defines a fixed, versioned corpus of blog posts and a set of curated
question/answer expectations used to measure how chat prompt or retrieval
changes affect citation quality.

Why a fixed corpus?
-------------------
Grounded chat is only as good as the posts it can retrieve and cite. To make
``expected_post_ids`` deterministic (and therefore a stable eval target) the
corpus below is authored once and versioned alongside the questions. A future
evaluation run indexes these exact posts and checks that the assistant cites
the expected ones.

Post ids
--------
In production, content post ids are MongoDB 24-character hex ObjectIds. The
ai-service pads them to 32 chars to form Qdrant point ids and strips the pad
back on read, so the ids returned by ``SearchPosts`` / cited by ``ChatAnswer``
are exactly these 24-hex strings. Every ``post_id`` here follows that format;
an evaluation run must index exactly these ids so cited ids line up with
``expected_post_ids``.

Row categories
--------------
* ``grounded``     -- a real question about the platform; expects one or more
                      cited post ids from the corpus.
* ``gibberish``    -- nonsense input; the assistant should retrieve nothing
                      and cite no posts (``expected_post_ids == []``).
* ``out_of_scope`` -- a coherent question unrelated to the platform; the
                      assistant should also cite nothing.

Every grounded row names the corpus posts that answer it. The build script
turns each row into a LangSmith example (inputs = query + history, outputs =
expected_post_ids + category) so evaluators can score citation accuracy.
"""

from __future__ import annotations

# Stable dataset name used both for the local artifact and the LangSmith
# dataset. Changing it creates a new versioned dataset.
DATASET_NAME = "topos-chat-eval"

# Fixed corpus. ``post_id`` values are 24-hex (MongoDB ObjectId style), matching
# how production content post ids look and how the ai-service returns them.
CORPUS: list[dict] = [
    {
        "post_id": "000000000000000000000001",
        "title": "Storing blog content in MongoDB",
        "body": (
            "Topos stores all blog content in MongoDB. Posts, tags, chats and "
            "their messages live in the blog_content database and are read back "
            "through indexed queries. MongoDB is the system of record for the "
            "content service."
        ),
        "summary": "The content service keeps posts, tags and chat history in MongoDB.",
        "tags": ["mongodb", "storage", "content"],
    },
    {
        "post_id": "000000000000000000000002",
        "title": "Caching with Redis",
        "body": (
            "The content service caches posts, tags, search and related results "
            "in Redis to keep read latency low. The cache is best-effort: if "
            "Redis is down the service falls back to MongoDB."
        ),
        "summary": "Redis caches read paths in the content service with a MongoDB fallback.",
        "tags": ["redis", "cache", "performance"],
    },
    {
        "post_id": "000000000000000000000003",
        "title": "Event streaming with Kafka",
        "body": (
            "Post mutations are published to the Kafka posts topic. Background "
            "workers consume the events to generate AI summaries and to index "
            "posts in the Qdrant vector store. A dead-letter queue (posts-dlq) "
            "captures failures for later replay."
        ),
        "summary": "Kafka carries post events that drive summaries and vector indexing.",
        "tags": ["kafka", "events", "workers"],
    },
    {
        "post_id": "000000000000000000000004",
        "title": "Vector search in Qdrant",
        "body": (
            "Semantic search and related posts run on Qdrant with hybrid dense "
            "and sparse vectors. Chat answers are grounded by retrieving the "
            "nearest posts to the user question from Qdrant."
        ),
        "summary": "Qdrant provides hybrid vector search that grounds chat answers.",
        "tags": ["qdrant", "vector", "search"],
    },
    {
        "post_id": "000000000000000000000005",
        "title": "Embeddings with Ollama",
        "body": (
            "Posts and chat queries are embedded with Ollama running the "
            "snowflake-arctic-embed2 model before they are stored in or searched "
            "against the vector store."
        ),
        "summary": "Ollama's snowflake-arctic-embed2 model produces embeddings for posts and queries.",
        "tags": ["ollama", "embeddings", "model"],
    },
    {
        "post_id": "000000000000000000000006",
        "title": "User accounts in Postgres",
        "body": (
            "The user service stores accounts, profiles and JWTs in Postgres. "
            "It runs a primary instance with two replicas behind Pgpool-II for "
            "read scaling, plus a Redis-backed session cache."
        ),
        "summary": "Postgres (with Pgpool-II replicas) holds accounts, profiles and JWTs.",
        "tags": ["postgres", "users", "database"],
    },
    {
        "post_id": "000000000000000000000007",
        "title": "GraphQL federation gateway",
        "body": (
            "The frontend talks only to the Apollo Router gateway at "
            "/graphql on port 4000. The gateway composes the user and content "
            "subgraphs into a single federated schema."
        ),
        "summary": "Apollo Router federates the user and content subgraphs behind one gateway.",
        "tags": ["graphql", "gateway", "federation"],
    },
    {
        "post_id": "000000000000000000000008",
        "title": "Content service in Go",
        "body": (
            "The content service is a Go GraphQL subgraph with Kafka workers. It "
            "owns posts and tags, triggers AI summary and vector indexing, and "
            "replays failed events from the dead-letter queue."
        ),
        "summary": "A Go GraphQL subgraph manages posts, tags and async AI indexing work.",
        "tags": ["go", "content", "graphql"],
    },
    {
        "post_id": "000000000000000000000009",
        "title": "AI service over gRPC",
        "body": (
            "The AI service is a Python gRPC service on port 50051. It produces "
            "summaries, tags and posts, and runs hybrid dense and sparse vector "
            "search over Qdrant for chat grounding and related posts."
        ),
        "summary": "A Python gRPC service handles summaries, tags and hybrid vector search.",
        "tags": ["ai", "grpc", "python"],
    },
    {
        "post_id": "00000000000000000000000a",
        "title": "Frontend with React and Vite",
        "body": (
            "The frontend is a React and Vite single-page app using shadcn/ui "
            "and Tailwind, with GraphQL codegen for typed queries. It runs on "
            "port 5173 in development."
        ),
        "summary": "A React + Vite SPA with shadcn/ui and GraphQL codegen powers the UI.",
        "tags": ["frontend", "react", "vite"],
    },
    {
        "post_id": "00000000000000000000000b",
        "title": "Authentication with JWTs",
        "body": (
            "The user service issues and validates JSON Web Tokens (JWTs) for "
            "authentication. Registration and profile endpoints are protected, "
            "and tokens are verified on every gateway request."
        ),
        "summary": "JWTs issued by the user service authenticate requests through the gateway.",
        "tags": ["auth", "jwt", "security"],
    },
    {
        "post_id": "00000000000000000000000c",
        "title": "Recommendations and taste profiles",
        "body": (
            "RecommendFeed builds a per-user interest profile in the Qdrant "
            "users collection from view, like and save interactions, weighted "
            "1.0, 3.0 and 5.0 respectively. SURPRISE mode queries the negated "
            "profile vector to surface posts unlike the user's taste."
        ),
        "summary": "Personalized feeds use weighted interaction profiles; SURPRISE diversifies them.",
        "tags": ["recommendations", "personalization", "profile"],
    },
    {
        "post_id": "00000000000000000000000d",
        "title": "Related posts",
        "body": (
            "The RelatedPosts RPC finds posts similar to an already-indexed post "
            "by querying the stored dense vector of that post, without "
            "re-embedding at read time."
        ),
        "summary": "RelatedPosts reuses a post's stored vector to find similar content.",
        "tags": ["related", "vector", "search"],
    },
    {
        "post_id": "00000000000000000000000e",
        "title": "AI summaries and tags",
        "body": (
            "When a post is created the AI service writes a three-sentence "
            "summary and extracts five to seven keyword tags. Summaries keep "
            "the main idea and key takeaways; tags improve discoverability."
        ),
        "summary": "AI generates a 3-sentence summary and 5-7 tags per post.",
        "tags": ["summarization", "tags", "ai"],
    },
    {
        "post_id": "00000000000000000000000f",
        "title": "Reliable indexing with the dead-letter queue",
        "body": (
            "If AI summary or vector indexing fails, the event lands on the "
            "posts-dlq topic. A replay worker retries those events so no post "
            "is left without a summary or vector."
        ),
        "summary": "The DLQ and replay worker guarantee every post is eventually indexed.",
        "tags": ["reliability", "dlq", "kafka"],
    },
]

# Curated question/answer expectations. Each row:
#   id                -- stable identifier
#   query             -- the user question
#   expected_post_ids -- corpus post ids that should be cited ([] for negatives)
#   category          -- grounded | gibberish | out_of_scope
#   history           -- optional prior turns as (role, content); empty by default
CURATED_QA: list[dict] = [
    # --- Grounded: storage & content (01, 02, 03) ---
    {
        "id": "q-001",
        "query": "where does topos store blog posts?",
        "expected_post_ids": ["000000000000000000000001"],
        "category": "grounded",
    },
    {
        "id": "q-002",
        "query": "what database holds the chat messages?",
        "expected_post_ids": ["000000000000000000000001"],
        "category": "grounded",
    },
    {
        "id": "q-003",
        "query": "how does the platform cache content?",
        "expected_post_ids": ["000000000000000000000002"],
        "category": "grounded",
    },
    {
        "id": "q-004",
        "query": "what happens to reads if redis goes down?",
        "expected_post_ids": ["000000000000000000000002"],
        "category": "grounded",
    },
    {
        "id": "q-005",
        "query": "what is kafka used for in topos?",
        "expected_post_ids": ["000000000000000000000003"],
        "category": "grounded",
    },
    {
        "id": "q-006",
        "query": "how are ai summaries triggered?",
        "expected_post_ids": ["000000000000000000000003"],
        "category": "grounded",
    },
    {
        "id": "q-007",
        "query": "tell me about the dead letter queue",
        "expected_post_ids": [
            "000000000000000000000003",
            "00000000000000000000000f",
        ],
        "category": "grounded",
    },
    # --- Grounded: search & embeddings (04, 05) ---
    {
        "id": "q-008",
        "query": "how does semantic search work?",
        "expected_post_ids": ["000000000000000000000004"],
        "category": "grounded",
    },
    {
        "id": "q-009",
        "query": "what vector database powers related posts?",
        "expected_post_ids": [
            "000000000000000000000004",
            "00000000000000000000000d",
        ],
        "category": "grounded",
    },
    {
        "id": "q-010",
        "query": "what embedding model does topos use?",
        "expected_post_ids": ["000000000000000000000005"],
        "category": "grounded",
    },
    {
        "id": "q-011",
        "query": "how are chat queries turned into vectors?",
        "expected_post_ids": ["000000000000000000000005"],
        "category": "grounded",
    },
    {
        "id": "q-012",
        "query": "explain hybrid dense and sparse search",
        "expected_post_ids": [
            "000000000000000000000004",
            "000000000000000000000009",
        ],
        "category": "grounded",
    },
    # --- Grounded: users & auth (06, 0b) ---
    {
        "id": "q-013",
        "query": "where are user accounts stored?",
        "expected_post_ids": ["000000000000000000000006"],
        "category": "grounded",
    },
    {
        "id": "q-014",
        "query": "does topos use a primary database with replicas?",
        "expected_post_ids": ["000000000000000000000006"],
        "category": "grounded",
    },
    {
        "id": "q-015",
        "query": "how does authentication work?",
        "expected_post_ids": ["00000000000000000000000b"],
        "category": "grounded",
    },
    {
        "id": "q-016",
        "query": "what are jwt tokens used for?",
        "expected_post_ids": ["00000000000000000000000b"],
        "category": "grounded",
    },
    {
        "id": "q-017",
        "query": "which service issues the jwt?",
        "expected_post_ids": [
            "000000000000000000000006",
            "00000000000000000000000b",
        ],
        "category": "grounded",
    },
    # --- Grounded: gateway & frontend (07, 0a) ---
    {
        "id": "q-018",
        "query": "what does the graphql gateway do?",
        "expected_post_ids": ["000000000000000000000007"],
        "category": "grounded",
    },
    {
        "id": "q-019",
        "query": "which port does the gateway listen on?",
        "expected_post_ids": ["000000000000000000000007"],
        "category": "grounded",
    },
    {
        "id": "q-020",
        "query": "what framework is the frontend built with?",
        "expected_post_ids": ["00000000000000000000000a"],
        "category": "grounded",
    },
    {
        "id": "q-021",
        "query": "how does the ui get its data?",
        "expected_post_ids": [
            "000000000000000000000007",
            "00000000000000000000000a",
        ],
        "category": "grounded",
    },
    # --- Grounded: ai service (08, 09, 0e) ---
    {
        "id": "q-022",
        "query": "what does the ai service do?",
        "expected_post_ids": ["000000000000000000000009"],
        "category": "grounded",
    },
    {
        "id": "q-023",
        "query": "what protocol does the ai service speak?",
        "expected_post_ids": ["000000000000000000000009"],
        "category": "grounded",
    },
    {
        "id": "q-024",
        "query": "how are post summaries generated?",
        "expected_post_ids": [
            "00000000000000000000000e",
            "000000000000000000000003",
        ],
        "category": "grounded",
    },
    {
        "id": "q-025",
        "query": "how many tags does the ai extract per post?",
        "expected_post_ids": ["00000000000000000000000e"],
        "category": "grounded",
    },
    {
        "id": "q-026",
        "query": "what service owns posts and tags?",
        "expected_post_ids": ["000000000000000000000008"],
        "category": "grounded",
    },
    {
        "id": "q-027",
        "query": "is the content service written in go?",
        "expected_post_ids": ["000000000000000000000008"],
        "category": "grounded",
    },
    {
        "id": "q-028",
        "query": "which service runs the grpc endpoints?",
        "expected_post_ids": ["000000000000000000000009"],
        "category": "grounded",
    },
    # --- Grounded: recommendations (0c, 0d) ---
    {
        "id": "q-029",
        "query": "how are recommendations personalized?",
        "expected_post_ids": ["00000000000000000000000c"],
        "category": "grounded",
    },
    {
        "id": "q-030",
        "query": "what weights are given to likes versus views?",
        "expected_post_ids": ["00000000000000000000000c"],
        "category": "grounded",
    },
    {
        "id": "q-031",
        "query": "what does surprise mode do?",
        "expected_post_ids": ["00000000000000000000000c"],
        "category": "grounded",
    },
    {
        "id": "q-032",
        "query": "how are related posts found?",
        "expected_post_ids": ["00000000000000000000000d"],
        "category": "grounded",
    },
    {
        "id": "q-033",
        "query": "does related posts re-embed the post at read time?",
        "expected_post_ids": ["00000000000000000000000d"],
        "category": "grounded",
    },
    # --- Grounded: reliability (0f) ---
    {
        "id": "q-034",
        "query": "what happens if vector indexing fails?",
        "expected_post_ids": ["00000000000000000000000f"],
        "category": "grounded",
    },
    {
        "id": "q-035",
        "query": "how does topos guarantee every post is indexed?",
        "expected_post_ids": [
            "00000000000000000000000f",
            "000000000000000000000003",
        ],
        "category": "grounded",
    },
    # --- Grounded: multi-turn history ---
    {
        "id": "q-036",
        "query": "what stores the posts then?",
        "expected_post_ids": ["000000000000000000000001"],
        "category": "grounded",
        "history": [
            ("user", "what is topos?"),
            ("assistant", "Topos is a blogging platform."),
        ],
    },
    {
        "id": "q-037",
        "query": "and how does it search them?",
        "expected_post_ids": ["000000000000000000000004"],
        "category": "grounded",
        "history": [
            ("user", "where are posts kept?"),
            ("assistant", "In MongoDB."),
        ],
    },
    {
        "id": "q-038",
        "query": "so the ai service does the embeddings?",
        "expected_post_ids": [
            "000000000000000000000009",
            "000000000000000000000005",
        ],
        "category": "grounded",
        "history": [
            ("user", "what generates summaries?"),
            ("assistant", "The AI service over gRPC."),
        ],
    },
    # --- Gibberish negatives (expect no citations) ---
    {
        "id": "q-039",
        "query": "asdkj qwe zxm lkj",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-040",
        "query": "blah blah bleh qwertyuiop",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-041",
        "query": "zzzxxx!!! ?? ????",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-042",
        "query": "mongodb redis kafka qdrant ollama postgres",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-043",
        "query": "ahsud hasud hhhh",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-044",
        "query": "qwkje ncnv alskdjf",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-045",
        "query": "1234567890 qwer asdf zxcv",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    {
        "id": "q-046",
        "query": "...................................",
        "expected_post_ids": [],
        "category": "gibberish",
    },
    # --- Out-of-scope negatives (expect no citations) ---
    {
        "id": "q-047",
        "query": "what is the weather in paris today?",
        "expected_post_ids": [],
        "category": "out_of_scope",
    },
    {
        "id": "q-048",
        "query": "who won the world cup in 2022?",
        "expected_post_ids": [],
        "category": "out_of_scope",
    },
    {
        "id": "q-049",
        "query": "can you write a poem about the ocean?",
        "expected_post_ids": [],
        "category": "out_of_scope",
    },
    {
        "id": "q-050",
        "query": "what is the capital of japan?",
        "expected_post_ids": [],
        "category": "out_of_scope",
    },
    {
        "id": "q-051",
        "query": "how do i reset my iphone password?",
        "expected_post_ids": [],
        "category": "out_of_scope",
    },
    {
        "id": "q-052",
        "query": "translate hello to french",
        "expected_post_ids": [],
        "category": "out_of_scope",
    },
]
