const pic = (seed: string, width = 1200, height = 630) =>
  `https://picsum.photos/seed/${seed}/${width}/${height}`;

const avatar = (seed: string) => `https://picsum.photos/seed/${seed}/200/200`;

export interface MockUser {
  id: string;
  username: string;
  email: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
}

export interface MockTag {
  id: string;
  name: string;
}

export interface MockPost {
  id: string;
  title: string;
  body: string;
  slug: string;
  imageUrl: string | null;
  summary: string;
  summaryStatus: "COMPLETED" | "PENDING";
  authorId: string;
  tagIds: string[];
  likedByMe: boolean;
  savedByMe: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockChatMessage {
  id: string;
  chatId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citedPostIds: string[];
  createdAt: string;
}

const buildBody = (intro: string, points: string[], outro: string) =>
  [
    `<p>${intro}</p>`,
    `<h2>Key considerations</h2>`,
    `<ul>${points.map((point) => `<li>${point}</li>`).join("")}</ul>`,
    `<p>${outro}</p>`,
  ].join("");

const users: MockUser[] = [
  {
    id: "user-1",
    username: "alexcarter",
    email: "alex@topos.dev",
    name: "Alex Carter",
    bio: "Staff engineer interested in distributed systems and developer tooling. Writing about what we learn while scaling Topos.",
    avatarUrl: avatar("alexcarter"),
    bannerUrl: pic("alexcarter-banner", 1600, 400),
    createdAt: "2024-01-10T08:00:00.000Z",
  },
  {
    id: "user-2",
    username: "marcusthorne",
    email: "marcus@topos.dev",
    name: "Marcus Thorne",
    bio: "ML infrastructure engineer. Previously at a large search company, now building retrieval systems.",
    avatarUrl: avatar("marcusthorne"),
    bannerUrl: pic("marcusthorne-banner", 1600, 400),
    createdAt: "2023-05-02T10:30:00.000Z",
  },
  {
    id: "user-3",
    username: "priyasharma",
    email: "priya@topos.dev",
    name: "Priya Sharma",
    bio: "Platform team lead. I care about boring, reliable infrastructure that lets product teams move fast.",
    avatarUrl: avatar("priyasharma"),
    bannerUrl: pic("priyasharma-banner", 1600, 400),
    createdAt: "2023-06-18T14:15:00.000Z",
  },
  {
    id: "user-4",
    username: "lucasmoreau",
    email: "lucas@topos.dev",
    name: "Lucas Moreau",
    bio: "Backend engineer with a soft spot for Go, Kafka, and systems that never lose a message.",
    avatarUrl: avatar("lucasmoreau"),
    bannerUrl: pic("lucasmoreau-banner", 1600, 400),
    createdAt: "2023-08-03T09:45:00.000Z",
  },
  {
    id: "user-5",
    username: "emilywu",
    email: "emily@topos.dev",
    name: "Emily Wu",
    bio: "Frontend architect. TypeScript, GraphQL, and making complex UIs feel simple.",
    avatarUrl: avatar("emilywu"),
    bannerUrl: pic("emilywu-banner", 1600, 400),
    createdAt: "2023-11-21T16:20:00.000Z",
  },
];

const tags: MockTag[] = [
  { id: "tag-architecture", name: "Architecture" },
  { id: "tag-distributed-systems", name: "Distributed Systems" },
  { id: "tag-go", name: "Go" },
  { id: "tag-typescript", name: "TypeScript" },
  { id: "tag-machine-learning", name: "Machine Learning" },
  { id: "tag-databases", name: "Databases" },
  { id: "tag-devops", name: "DevOps" },
  { id: "tag-security", name: "Security" },
];

const posts: MockPost[] = [
  {
    id: "post-1",
    title: "Optimizing Neural Network Throughput for Low-Latency Architectures",
    slug: "optimizing-neural-network-throughput-for-low-latency-architectures",
    body: buildBody(
      "Model quality matters, but so does the time it takes to serve a prediction. In production, a great model that cannot fit inside your latency budget is useless.",
      [
        "Kernel fusion removes launch overhead by combining element-wise operations into a single pass.",
        "INT8 quantization cuts memory bandwidth roughly fourfold with a carefully calibrated calibration set.",
        "Continuous batching keeps the GPU saturated even when requests arrive in sparse bursts.",
      ],
      "Start by profiling where time actually goes before reaching for any of these techniques; the fastest optimization is usually removing work entirely.",
    ),
    imageUrl: pic("nn-throughput"),
    summary:
      "Practical techniques for reducing inference latency: kernel fusion, quantization, and batching strategies that keep GPUs saturated.",
    summaryStatus: "COMPLETED",
    authorId: "user-2",
    tagIds: ["tag-machine-learning", "tag-architecture"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2023-10-24T09:00:00.000Z",
    updatedAt: "2023-11-02T11:00:00.000Z",
  },
  {
    id: "post-2",
    title: "Federation in Production: Lessons from Splitting a Monolith Graph",
    slug: "federation-in-production-lessons-from-splitting-a-monolith-graph",
    body: buildBody(
      "Splitting one giant GraphQL schema into federated subgraphs sounded clean on paper and chaotic in practice. Here is what we learned moving Topos to Apollo Federation.",
      [
        "Agree on entity keys early; changing a @key later forces a migration of every referencing subgraph.",
        "Keep cross-subgraph queries small; each hop between services adds real network latency.",
        "Version the router configuration like application code and review every supergraph change.",
      ],
      "Federation bought us team autonomy, but only after we invested in tooling, tests, and a disciplined review process.",
    ),
    imageUrl: pic("federation-split"),
    summary:
      "A field report on moving a monolith GraphQL schema to Apollo Federation, including key choices, migration traps, and operational lessons.",
    summaryStatus: "COMPLETED",
    authorId: "user-3",
    tagIds: ["tag-architecture", "tag-distributed-systems"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2023-11-20T13:20:00.000Z",
    updatedAt: "2023-11-28T09:10:00.000Z",
  },
  {
    id: "post-3",
    title: "Rust Ownership for Go Developers",
    slug: "rust-ownership-for-go-developers",
    body: buildBody(
      "If you come from Go, Rust feels like the same systems niche with a borrow checker standing in the doorway. Once the ownership model clicks, it stops being an obstacle.",
      [
        "Ownership answers one question: who is responsible for freeing this memory when the scope ends?",
        "References borrow values without taking ownership, which is why &T can coexist with many readers.",
        "The compiler is on your side; fighting borrow errors usually means the data flow itself needs restructuring.",
      ],
      "Go gives you safety through simplicity, Rust through a stricter compiler. Both work; they just put the discipline in different places.",
    ),
    imageUrl: pic("rust-ownership"),
    summary:
      "An introduction to Rust ownership, borrowing, and lifetimes framed around the mental models Go developers already have.",
    summaryStatus: "COMPLETED",
    authorId: "user-4",
    tagIds: ["tag-go", "tag-distributed-systems"],
    likedByMe: true,
    savedByMe: false,
    createdAt: "2023-12-05T10:05:00.000Z",
    updatedAt: "2023-12-10T16:40:00.000Z",
  },
  {
    id: "post-4",
    title: "TypeScript Generics Deep Dive: From Basics to Conditional Types",
    slug: "typescript-generics-deep-dive-from-basics-to-conditional-types",
    body: buildBody(
      "Generics are where TypeScript stops being a linter and becomes a language you can reason about. This walkthrough goes from simple type parameters to conditional types and inference.",
      [
        "A type parameter is a promise: whatever the caller supplies, you handle consistently.",
        "Conditional types act as type-level if statements and unlock mapped type magic like Partial and Pick.",
        "Infer lets you extract hidden types from other types, which is how libraries like Zod stay ergonomic.",
      ],
      "You rarely need the full toolbox, but understanding it changes how you read and design type declarations.",
    ),
    imageUrl: pic("ts-generics"),
    summary:
      "A practical walkthrough of TypeScript generics, conditional types, and inference with real-world examples.",
    summaryStatus: "COMPLETED",
    authorId: "user-5",
    tagIds: ["tag-typescript"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-01-15T12:00:00.000Z",
    updatedAt: "2024-01-20T08:30:00.000Z",
  },
  {
    id: "post-5",
    title: "Sharding MongoDB Without Downtime",
    slug: "sharding-mongodb-without-downtime",
    body: buildBody(
      "The collection outgrew a single replica set and we had to shard it in production with zero maintenance windows. Here is the playbook that worked for us.",
      [
        "Choose a shard key with high cardinality; a key with few distinct values turns sharding into a hot-spot generator.",
        "Backfill data before flipping traffic so the initial move is a copy, not a migration.",
        "Run canary reads against the sharded cluster while writes still hit the old topology.",
      ],
      "A boring migration is a good migration. The only surprising part was how much prep happened before a single byte moved.",
    ),
    imageUrl: pic("mongo-sharding"),
    summary:
      "How we sharded a hot MongoDB collection in production without a maintenance window, including shard key selection and canary rollout.",
    summaryStatus: "COMPLETED",
    authorId: "user-2",
    tagIds: ["tag-databases", "tag-distributed-systems"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-02-08T09:30:00.000Z",
    updatedAt: "2024-02-14T17:45:00.000Z",
  },
  {
    id: "post-6",
    title: "Postgres at Scale: Connection Pooling Done Right",
    slug: "postgres-at-scale-connection-pooling-done-right",
    body: buildBody(
      "Every connection to Postgres costs memory and context switches. When your app is bursting with 200 replicas, naive pooling is the first thing that falls over.",
      [
        "Pool connections at the proxy layer so app instances share a bounded set of backend connections.",
        "Tune pool size against query duration, not instance count; the math is roughly requests per second times query time.",
        "Watch for idle session pins from long transactions that silently defeat your pool.",
      ],
      "The right pool size is smaller than you think. We run with far fewer connections per instance than our original estimate.",
    ),
    imageUrl: pic("postgres-pooling"),
    summary:
      "A guide to sizing and operating connection pools in front of Postgres, with the math and pitfalls we hit at scale.",
    summaryStatus: "COMPLETED",
    authorId: "user-3",
    tagIds: ["tag-databases", "tag-devops"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-03-12T14:50:00.000Z",
    updatedAt: "2024-03-18T10:15:00.000Z",
  },
  {
    id: "post-7",
    title: "Zero-Trust Networking for Microservices",
    slug: "zero-trust-networking-for-microservices",
    body: buildBody(
      "Trusting the network because it is inside your VPC is a comfortable lie. Zero-trust treats every request as potentially hostile, and it is more practical than it sounds.",
      [
        "Mutual TLS between services replaces network boundaries with cryptographic identity.",
        "Short-lived certificates plus automatic rotation mean a stolen credential expires on its own.",
        "Fine-grained policies at the proxy let you express which service may call which endpoint, not just which port.",
      ],
      "Start with the highest-value paths and expand gradually; zero-trust is a journey, not a flag flip.",
    ),
    imageUrl: pic("zero-trust"),
    summary:
      "An overview of zero-trust networking: mutual TLS, short-lived certificates, and proxy-enforced service policies.",
    summaryStatus: "COMPLETED",
    authorId: "user-4",
    tagIds: ["tag-security", "tag-devops"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-04-01T08:00:00.000Z",
    updatedAt: "2024-04-06T12:25:00.000Z",
  },
  {
    id: "post-8",
    title: "Building a Vector Search Pipeline with Dense and Sparse Embeddings",
    slug: "building-a-vector-search-pipeline-with-dense-and-sparse-embeddings",
    body: buildBody(
      "Keyword search finds exact terms but misses meaning; dense vectors capture meaning but miss exact terms. Hybrid search gets both by combining the two signals.",
      [
        "Dense embeddings capture semantic similarity but can struggle with rare or domain-specific terminology.",
        "Sparse vectors behave like learned BM25 and preserve precise term matching.",
        "Fusion at the ranker level, not the retrieval level, gives you the best of both worlds.",
      ],
      "We index every post into Qdrant as both dense and sparse vectors, then fuse scores at query time. The lift in relevance was immediate.",
    ),
    imageUrl: pic("vector-pipeline"),
    summary:
      "How we built hybrid dense-plus-sparse vector search for Topos posts, from embedding generation to score fusion.",
    summaryStatus: "PENDING",
    authorId: "user-5",
    tagIds: ["tag-machine-learning", "tag-databases"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-05-19T11:10:00.000Z",
    updatedAt: "2024-05-19T11:10:00.000Z",
  },
  {
    id: "post-9",
    title: "Tuning the Go Garbage Collector for Low Latency",
    slug: "tuning-the-go-garbage-collector-for-low-latency",
    body: buildBody(
      "Go's GC is a background friend until a latency spike shows up on your p99 chart. Understanding GOGC and memory limits turns it back into a dialable knob.",
      [
        "GOGC sets the heap growth target between GC cycles; lower values mean shorter, more frequent pauses.",
        "GOMEMLIMIT lets you cap the heap and trade throughput for consistent latency.",
        "Allocating less is the real fix: pool objects and reuse buffers instead of tuning knobs forever.",
      ],
      "We cut p99 GC pause from 40ms to under 2ms by reducing allocation churn and setting a sane memory limit.",
    ),
    imageUrl: pic("go-gc"),
    summary:
      "Tuning Go garbage collection for latency-sensitive services using GOGC, GOMEMLIMIT, and allocation discipline.",
    summaryStatus: "COMPLETED",
    authorId: "user-2",
    tagIds: ["tag-go", "tag-machine-learning"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-06-23T15:35:00.000Z",
    updatedAt: "2024-06-30T09:05:00.000Z",
  },
  {
    id: "post-10",
    title: "GraphQL Caching Strategies with Apollo",
    slug: "graphql-caching-strategies-with-apollo",
    body: buildBody(
      "GraphQL clients cache responses, but only if you tell them how. Apollo's normalized cache is powerful and forgiving, which is exactly why it needs care.",
      [
        "Normalization keys on __typename and id, so the same object is cached once across all queries.",
        "Cache policies per field control staleness, from cache-first for hot data to network-only for fresh reads.",
        "Evict and garbage-collect after mutations, or stale lists will haunt your UI.",
      ],
      "The cache is a client-side database; design its policies the way you would design indexes, deliberately.",
    ),
    imageUrl: pic("apollo-caching"),
    summary:
      "Practical Apollo Client caching: normalized cache behavior, field policies, and keeping lists fresh after mutations.",
    summaryStatus: "COMPLETED",
    authorId: "user-3",
    tagIds: ["tag-typescript", "tag-architecture"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-07-30T10:45:00.000Z",
    updatedAt: "2024-08-04T14:20:00.000Z",
  },
  {
    id: "post-11",
    title: "Kafka Consumer Design Patterns for Reliable Event Processing",
    slug: "kafka-consumer-design-patterns-for-reliable-event-processing",
    body: buildBody(
      "Kafka gives you at-least-once delivery and a partition model that punishes naive consumers. These patterns keep processing reliable without over-engineering.",
      [
        "Design for reprocessing: your consumer should treat every message as if it might arrive twice.",
        "Store consumer offsets only after side effects commit, or you will lose events on crash.",
        "Keep partition keys stable so related events land in order and the same consumer.",
      ],
      "Combine this with a DLQ and replay tooling, and Kafka becomes boring in the best way possible.",
    ),
    imageUrl: pic("kafka-patterns"),
    summary:
      "Reliable Kafka consumption patterns: idempotency, offset management, partition keys, and DLQ-based replay.",
    summaryStatus: "COMPLETED",
    authorId: "user-4",
    tagIds: ["tag-distributed-systems", "tag-devops"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-08-14T09:25:00.000Z",
    updatedAt: "2024-08-19T11:50:00.000Z",
  },
  {
    id: "post-12",
    title: "Securing JWTs in SPAs: Storage and Refresh Strategies",
    slug: "securing-jwts-in-spas-storage-and-refresh-strategies",
    body: buildBody(
      "Where you store a token matters more than how you sign it. LocalStorage is convenient and XSS-readable; the alternatives trade convenience for safety.",
      [
        "HttpOnly cookies keep tokens out of JavaScript's reach but add CSRF considerations.",
        "Short-lived access tokens with rotating refresh tokens limit the blast radius of theft.",
        "Sliding sessions based on active use give a good compromise between security and UX.",
      ],
      "There is no perfect answer, only a threat model you can defend. Pick the trade-off your app can actually enforce.",
    ),
    imageUrl: pic("jwt-spas"),
    summary:
      "Token storage, refresh rotation, and session strategies for single-page apps, mapped to the threat model each one defends against.",
    summaryStatus: "COMPLETED",
    authorId: "user-5",
    tagIds: ["tag-security", "tag-typescript"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-09-05T13:15:00.000Z",
    updatedAt: "2024-09-10T10:40:00.000Z",
  },
  {
    id: "post-13",
    title: "How We Cut p95 Latency by 60% Without Changing the Architecture",
    slug: "how-we-cut-p95-latency-by-60-without-changing-the-architecture",
    body: buildBody(
      "No new services, no rewrite, no exotic infrastructure. We found 60% of p95 latency hiding in three ordinary places and fixed all of them.",
      [
        "Removing a serialized dependency between two calls turned a waterfall into a fan-out.",
        "Caching hot reads at the edge of the service cut the most expensive query path entirely.",
        "Right-sizing connection pools stopped queueing under burst traffic.",
      ],
      "Profile first. The architectural rewrite we never did would have taken a year and bought us less than these three fixes.",
    ),
    imageUrl: pic("p95-latency"),
    summary:
      "Three unglamorous fixes that cut p95 latency by 60%: dependency removal, edge caching, and connection pool sizing.",
    summaryStatus: "COMPLETED",
    authorId: "user-2",
    tagIds: ["tag-devops", "tag-architecture"],
    likedByMe: true,
    savedByMe: true,
    createdAt: "2024-10-11T08:55:00.000Z",
    updatedAt: "2024-10-15T16:30:00.000Z",
  },
  {
    id: "post-14",
    title: "Fine-Tuning Embedding Models for Domain-Specific Search",
    slug: "fine-tuning-embedding-models-for-domain-specific-search",
    body: buildBody(
      "Off-the-shelf embeddings are great at general similarity and mediocre at your domain. Fine-tuning on a modest set of curated pairs closes most of that gap.",
      [
        "Curate hard negatives: pairs that look similar but are not, so the model learns what to reject.",
        "Contrastive training with in-batch negatives is cheap and effective for retrieval.",
        "Evaluate on the real ranking task, not on embedding distance, because distance is a proxy that lies.",
      ],
      "With a few hundred curated pairs and one training run we measurably improved search relevance for technical content.",
    ),
    imageUrl: pic("embedding-finetune"),
    summary:
      "How to fine-tune embedding models for domain search: hard negatives, contrastive training, and task-level evaluation.",
    summaryStatus: "COMPLETED",
    authorId: "user-3",
    tagIds: ["tag-machine-learning"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2024-11-22T12:40:00.000Z",
    updatedAt: "2024-11-27T09:00:00.000Z",
  },
  {
    id: "post-15",
    title: "Designing Idempotent APIs for Distributed Systems",
    slug: "designing-idempotent-apis-for-distributed-systems",
    body: buildBody(
      "Retries are how distributed systems heal, and retries require idempotency. An API that cannot be safely retried is an API that will eventually duplicate work.",
      [
        "Accept a client-generated idempotency key for mutating operations and dedupe on it.",
        "Return the stored response for a replayed key instead of executing the operation again.",
        "Design natural keys: a create-by-name endpoint can be idempotent by uniqueness alone.",
      ],
      "Idempotency keys are a small contract with outsized reliability returns once partial failures become routine.",
    ),
    imageUrl: pic("idempotent-apis"),
    summary:
      "Patterns for idempotent APIs: client keys, stored responses, and natural keys that make retries safe.",
    summaryStatus: "COMPLETED",
    authorId: "user-4",
    tagIds: ["tag-distributed-systems", "tag-go"],
    likedByMe: false,
    savedByMe: false,
    createdAt: "2025-01-08T10:20:00.000Z",
    updatedAt: "2025-01-12T15:05:00.000Z",
  },
  {
    id: "post-16",
    title: "Database Migrations Without Fear: A Zero-Downtime Playbook",
    slug: "database-migrations-without-fear-a-zero-downtime-playbook",
    body: buildBody(
      "Schema changes used to mean maintenance windows. With expand-and-contract migrations, they mean nothing at all to your users.",
      [
        "Expand first: add the new column or table while old code still runs against the old shape.",
        "Dual-write during the transition so both schema versions stay in sync.",
        "Contract last: backfill, verify, then drop the old structure in a later release.",
      ],
      "The rule is simple: never change schema and code in the same deploy, and every migration becomes reversible.",
    ),
    imageUrl: pic("db-migrations"),
    summary:
      "A zero-downtime migration playbook using expand-and-contract: dual writes, backfills, and safe rollouts.",
    summaryStatus: "COMPLETED",
    authorId: "user-5",
    tagIds: ["tag-databases", "tag-devops"],
    likedByMe: false,
    savedByMe: true,
    createdAt: "2025-02-17T09:40:00.000Z",
    updatedAt: "2025-02-20T13:30:00.000Z",
  },
];

const chats: MockChat[] = [
  {
    id: "chat-1",
    title: "Rust vs Go for backend services",
    createdAt: "2025-06-01T10:00:00.000Z",
    updatedAt: "2025-06-01T10:15:00.000Z",
  },
  {
    id: "chat-2",
    title: "Scaling Postgres",
    createdAt: "2025-06-05T14:30:00.000Z",
    updatedAt: "2025-06-05T14:35:00.000Z",
  },
];

const chatMessages: MockChatMessage[] = [
  {
    id: "message-1",
    chatId: "chat-1",
    role: "USER",
    content: "What are the main trade-offs between Rust and Go for building backend services?",
    citedPostIds: [],
    createdAt: "2025-06-01T10:00:00.000Z",
  },
  {
    id: "message-2",
    chatId: "chat-1",
    role: "ASSISTANT",
    content:
      "Both are excellent for backend work, but they trade different currencies. Go keeps the team moving fast with a simple language and a great toolchain, while Rust offers stronger guarantees at the cost of a steeper learning curve. If you are a Go team, the ownership model is the biggest adjustment, but it pays off where memory safety and peak performance matter. Two of our posts cover this directly.",
    citedPostIds: ["post-3", "post-9"],
    createdAt: "2025-06-01T10:01:00.000Z",
  },
  {
    id: "message-3",
    chatId: "chat-1",
    role: "USER",
    content: "Which one has a smoother learning curve for a Go team?",
    citedPostIds: [],
    createdAt: "2025-06-01T10:08:00.000Z",
  },
  {
    id: "message-4",
    chatId: "chat-1",
    role: "ASSISTANT",
    content:
      "Go, without question. You can be productive in a week because there is very little to learn beyond the standard library and goroutines. Rust takes months of focused practice before the borrow checker stops slowing you down. That said, the article on Rust ownership for Go developers argues the model becomes intuitive once it clicks.",
    citedPostIds: ["post-3"],
    createdAt: "2025-06-01T10:09:00.000Z",
  },
  {
    id: "message-5",
    chatId: "chat-2",
    role: "USER",
    content: "What is the right way to handle connection exhaustion under high concurrency?",
    citedPostIds: [],
    createdAt: "2025-06-05T14:30:00.000Z",
  },
  {
    id: "message-6",
    chatId: "chat-2",
    role: "ASSISTANT",
    content:
      "The short answer is to pool connections at the proxy layer and size the pool against query duration rather than instance count. We wrote about the exact math and the pitfalls we hit, including idle session pins silently defeating the pool.",
    citedPostIds: ["post-6"],
    createdAt: "2025-06-05T14:31:00.000Z",
  },
];

let nextPostId = 100;
let nextChatId = 100;
let nextMessageId = 100;
let signedInUser: MockUser | null = null;

const getUser = (id: string) => {
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error(`Mock user ${id} not found`);
  return user;
};

const getTag = (id: string) => {
  const tag = tags.find((t) => t.id === id);
  if (!tag) throw new Error(`Mock tag ${id} not found`);
  return tag;
};

const getChat = (id: string) => {
  const chat = chats.find((c) => c.id === id);
  if (!chat) throw new Error(`Mock chat ${id} not found`);
  return chat;
};

const sortNewestFirst = <T extends { createdAt: string }>(items: T[]) =>
  [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

const paginate = <T>(items: T[], page: number, limit: number) => {
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    totalPages: Math.max(1, Math.ceil(items.length / limit)),
    currentPage: page,
    total: items.length,
  };
};

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const titleCase = (value: string) =>
  value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));

const nowIso = () => new Date().toISOString();

const toTagResponse = (tag: MockTag) => ({
  __typename: "Tag",
  id: tag.id,
  name: tag.name,
});

const toAuthorPreview = (user: MockUser) => ({
  __typename: "User",
  id: user.id,
  username: user.username,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

export const toUserResponse = (user: MockUser) => ({
  __typename: "User",
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  bio: user.bio,
  avatarUrl: user.avatarUrl,
  bannerUrl: user.bannerUrl,
  createdAt: user.createdAt,
});

export const toPostCardResponse = (post: MockPost) => ({
  __typename: "Post",
  id: post.id,
  title: post.title,
  body: post.body,
  imageUrl: post.imageUrl,
  createdAt: post.createdAt,
  likedByMe: post.likedByMe,
  savedByMe: post.savedByMe,
  author: toAuthorPreview(getUser(post.authorId)),
  tags: post.tagIds.map(getTag).map(toTagResponse),
});

export const toPostDetailResponse = (post: MockPost) => {
  const author = getUser(post.authorId);
  const related = posts
    .filter((p) => p.id !== post.id && p.tagIds.some((t) => post.tagIds.includes(t)))
    .sort((a, b) => {
      const overlap =
        b.tagIds.filter((t) => post.tagIds.includes(t)).length -
        a.tagIds.filter((t) => post.tagIds.includes(t)).length;
      if (overlap !== 0) return overlap;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, 5);

  return {
    ...toPostCardResponse(post),
    slug: post.slug,
    summary: post.summary,
    summaryStatus: post.summaryStatus,
    updatedAt: post.updatedAt,
    author: {
      ...toAuthorPreview(author),
      email: author.email,
      bio: author.bio,
    },
    related: related.map(toPostCardResponse),
  };
};

const toPaginatedPostsResponse = (items: MockPost[], page: number, limit: number) => {
  const { items: pageItems, totalPages, currentPage, total } = paginate(items, page, limit);
  return {
    __typename: "PaginatedPosts",
    posts: pageItems.map(toPostCardResponse),
    totalPages,
    currentPage,
    totalPosts: total,
  };
};

const toChatResponse = (chat: MockChat) => ({
  __typename: "Chat",
  id: chat.id,
  title: chat.title,
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
});

const toChatMessageResponse = (message: MockChatMessage) => ({
  __typename: "ChatMessage",
  id: message.id,
  chatId: message.chatId,
  role: message.role,
  content: message.content,
  citedPostIds: message.citedPostIds,
  createdAt: message.createdAt,
});

export const listPosts = (page = 1, limit = 6) =>
  toPaginatedPostsResponse(sortNewestFirst(posts), page, limit);

export const listPostsByTag = (tag: string, page = 1, limit = 6) =>
  toPaginatedPostsResponse(
    sortNewestFirst(posts.filter((post) => post.tagIds.some((id) => getTag(id).name === tag))),
    page,
    limit,
  );

export const searchPosts = (query: string, page = 1, limit = 6) => {
  const needle = query.toLowerCase();
  const hits = sortNewestFirst(
    posts.filter((post) => {
      const author = getUser(post.authorId);
      const haystack = [
        post.title,
        post.body,
        post.summary,
        author.username,
        author.name,
        ...post.tagIds.map((id) => getTag(id).name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    }),
  );
  const { items: pageItems, total } = paginate(hits, page, limit);
  return {
    __typename: "SearchResult",
    hits: pageItems.map(toPostCardResponse),
    total,
  };
};

export const getPost = (id: string) => {
  const post = posts.find((p) => p.id === id);
  return post ? toPostDetailResponse(post) : null;
};

export const listTags = (query: string, limit = 6) => {
  const needle = query.toLowerCase();
  return tags
    .filter((tag) => tag.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map(toTagResponse);
};

export const getSignedInUser = () => signedInUser;

export const authenticate = () => {
  const user = signedInUser ?? users[0];
  signedInUser = user;
  return {
    __typename: "AuthPayload",
    token: "mock-token",
    user: toUserResponse(user),
  };
};

export const updateProfile = (input: {
  name?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}) => {
  const user = signedInUser ?? users[0];
  if (input.name !== undefined && input.name !== null) user.name = input.name;
  if (input.bio !== undefined && input.bio !== null) user.bio = input.bio;
  if (input.avatarUrl !== undefined && input.avatarUrl !== null) user.avatarUrl = input.avatarUrl;
  if (input.bannerUrl !== undefined && input.bannerUrl !== null) user.bannerUrl = input.bannerUrl;
  return toUserResponse(user);
};

export const createPost = (input: {
  title: string;
  body: string;
  summary?: string | null;
  tags?: string[] | null;
  imageUrl?: string | null;
}) => {
  if (!signedInUser) throw new Error("Not authenticated");
  const now = nowIso();
  const post: MockPost = {
    id: `post-${nextPostId++}`,
    title: input.title,
    body: input.body,
    slug: slugify(input.title),
    imageUrl: input.imageUrl ?? null,
    summary: input.summary ?? "",
    summaryStatus: input.summary ? "COMPLETED" : "PENDING",
    authorId: signedInUser.id,
    tagIds: resolveTagIds(input.tags),
    likedByMe: false,
    savedByMe: false,
    createdAt: now,
    updatedAt: now,
  };
  posts.push(post);
  return { __typename: "Post", id: post.id };
};

export const updatePost = (id: string, input: {
  title?: string | null;
  body?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  imageUrl?: string | null;
}) => {
  const post = posts.find((p) => p.id === id);
  if (!post) throw new Error(`Mock post ${id} not found`);
  if (input.title !== undefined && input.title !== null) {
    post.title = input.title;
    post.slug = slugify(input.title);
  }
  if (input.body !== undefined && input.body !== null) post.body = input.body;
  if (input.summary !== undefined && input.summary !== null) post.summary = input.summary;
  if (input.imageUrl !== undefined && input.imageUrl !== null) post.imageUrl = input.imageUrl;
  if (input.tags !== undefined && input.tags !== null) post.tagIds = resolveTagIds(input.tags);
  post.updatedAt = nowIso();
  return toPostDetailResponse(post);
};

export const deletePost = (id: string) => {
  const index = posts.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`Mock post ${id} not found`);
  posts.splice(index, 1);
  return true;
};

export const togglePostLike = (postId: string) => {
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Mock post ${postId} not found`);
  post.likedByMe = !post.likedByMe;
  return post.likedByMe;
};

export const togglePostSave = (postId: string) => {
  const post = posts.find((p) => p.id === postId);
  if (!post) throw new Error(`Mock post ${postId} not found`);
  post.savedByMe = !post.savedByMe;
  return post.savedByMe;
};

export const recordPostView = () => true;

const resolveTagIds = (names?: string[] | null) =>
  (names ?? []).map((name) => {
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const tag: MockTag = { id: `tag-${nextPostId}-${tags.length}`, name };
    tags.push(tag);
    return tag.id;
  });

const TAG_KEYWORDS: Array<[keyword: string, tagName: string]> = [
  ["go", "Go"],
  ["rust", "Go"],
  ["typescript", "TypeScript"],
  ["graphql", "TypeScript"],
  ["mongodb", "Databases"],
  ["postgres", "Databases"],
  ["sql", "Databases"],
  ["database", "Databases"],
  ["vector", "Machine Learning"],
  ["neural", "Machine Learning"],
  ["embedding", "Machine Learning"],
  ["model", "Machine Learning"],
  ["kubernetes", "DevOps"],
  ["docker", "DevOps"],
  ["latency", "DevOps"],
  ["jwt", "Security"],
  ["auth", "Security"],
  ["security", "Security"],
  ["kafka", "Distributed Systems"],
  ["microservice", "Distributed Systems"],
  ["event", "Distributed Systems"],
  ["federation", "Architecture"],
  ["cache", "Architecture"],
];

export const generateTags = (title: string, body: string) => {
  const haystack = `${title} ${body}`.toLowerCase();
  const matches = TAG_KEYWORDS.filter(([keyword]) => haystack.includes(keyword)).map(
    ([, tagName]) => tagName,
  );
  const unique = [...new Set(matches)];
  return unique.length > 0 ? unique.slice(0, 4) : ["Architecture", "Distributed Systems", "Go"];
};

export const generatePostContent = (prompt: string) => {
  const titleWords = prompt.trim().split(/\s+/).slice(0, 10).join(" ");
  const title = titleCase(titleWords) || "Untitled Draft";
  return {
    __typename: "GeneratedPost",
    title,
    body: buildBody(
      `This draft was generated from your prompt: "${prompt.trim()}". It provides a starting point you can edit into a full post.`,
      [
        "Start with the concrete problem your readers face before introducing your approach.",
        "Include a real example with numbers; abstract advice is hard to evaluate.",
        "End with a short section on what you would do differently next time.",
      ],
      "Use this as scaffolding. The best posts come from your own experience layered on top of a solid outline.",
    ),
    summary: `A generated draft exploring ${title.toLowerCase()}, structured around the problem, an example, and lessons learned.`,
    tags: generateTags(prompt, ""),
  };
};

export const listChats = (page = 1, limit = 10) => {
  const { items: pageItems, totalPages, currentPage, total } = paginate(
    sortNewestFirst(chats),
    page,
    limit,
  );
  return {
    __typename: "PaginatedChats",
    chats: pageItems.map(toChatResponse),
    totalPages,
    currentPage,
    totalChats: total,
  };
};

export const getChatResponse = (id: string) => {
  const chat = chats.find((c) => c.id === id);
  return chat ? toChatResponse(chat) : null;
};

export const listChatMessages = (chatId: string, page = 1, limit = 20) => {
  const { items: pageItems, totalPages, currentPage, total } = paginate(
    chatMessages.filter((message) => message.chatId === chatId),
    page,
    limit,
  );
  return {
    __typename: "PaginatedMessages",
    messages: pageItems.map(toChatMessageResponse),
    totalPages,
    currentPage,
    totalMessages: total,
  };
};

export const createChat = (title: string | null | undefined) => {
  const now = nowIso();
  const chat: MockChat = {
    id: `chat-${nextChatId++}`,
    title: title ?? "New conversation",
    createdAt: now,
    updatedAt: now,
  };
  chats.unshift(chat);
  return toChatResponse(chat);
};

export const renameChat = (id: string, title: string) => {
  const chat = getChat(id);
  chat.title = title;
  chat.updatedAt = nowIso();
  return toChatResponse(chat);
};

export const deleteChat = (id: string) => {
  const index = chats.findIndex((c) => c.id === id);
  if (index === -1) throw new Error(`Mock chat ${id} not found`);
  chats.splice(index, 1);
  return true;
};

const ASSISTANT_REPLIES: Array<{ content: string; citedPostIds: string[] }> = [
  {
    content:
      "Good question. In our experience the answer depends on whether you are optimizing for throughput or consistency. We covered related patterns in two posts that might help: one on reliable event processing and another on idempotent APIs.",
    citedPostIds: ["post-11", "post-15"],
  },
  {
    content:
      "There is a well-trodden path here. Start by measuring where the time actually goes, then apply the cheapest fix that moves the metric. Our post on cutting p95 latency walks through three fixes that worked in production.",
    citedPostIds: ["post-13"],
  },
  {
    content:
      "This connects to how we run search at Topos. We use hybrid dense and sparse embeddings fused at the ranker level, and fine-tuned the embedding model on curated pairs. The posts below go into both halves of the pipeline.",
    citedPostIds: ["post-8", "post-14"],
  },
  {
    content:
      "The safest approach is expand-and-contract: add the new structure while old code still runs, dual-write during the transition, and drop the old structure only after backfill and verification. Our zero-downtime migration playbook has the full sequence.",
    citedPostIds: ["post-16"],
  },
];

export const askChat = (chatId: string, query: string) => {
  getChat(chatId);
  const now = nowIso();
  chatMessages.push({
    id: `message-${nextMessageId++}`,
    chatId,
    role: "USER",
    content: query,
    citedPostIds: [],
    createdAt: now,
  });
  const reply = ASSISTANT_REPLIES[chatMessages.length % ASSISTANT_REPLIES.length];
  const message: MockChatMessage = {
    id: `message-${nextMessageId++}`,
    chatId,
    role: "ASSISTANT",
    content: reply.content,
    citedPostIds: reply.citedPostIds,
    createdAt: nowIso(),
  };
  chatMessages.push(message);
  const chat = getChat(chatId);
  chat.updatedAt = message.createdAt;
  return toChatMessageResponse(message);
};