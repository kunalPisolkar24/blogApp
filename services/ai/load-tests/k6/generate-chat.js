import grpc from 'k6/net/grpc';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import {
    client,
    ensureConnected,
    getDefaultOptions,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 100;

// Chat streams an LLM answer per call, so its latency budget is wider
// than the unary RPCs; the Makefile picks generous defaults for
// embedding-ollama and llm-real runs.
const chatP95 = parseInt(__ENV.CHAT_P95) || 500;
const chatP99 = parseInt(__ENV.CHAT_P99) || 1500;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        chat_duration: [`p(95)<${chatP95}`, `p(99)<${chatP99}`],
    },
};

// Same seeded corpus as generate-search.js, so answers are grounded in
// real content under every embedding mode.
const SEED_POSTS = [
    { postId: '6a75a41221a9752ec47bc6df', title: 'Running Ollama Locally', body: 'How to run ollama on your own machine.' },
    { postId: '6a75a41221a9752ec47bc6e0', title: 'Qdrant Vector Search Guide', body: 'Hybrid search with dense and sparse vectors.' },
    { postId: '6a75a41221a9752ec47bc6e1', title: 'Redis Caching Patterns', body: 'Cache invalidation strategies with redis.' },
    { postId: '6a75a41221a9752ec47bc6e2', title: 'Scaling Kafka Consumers', body: 'Consumer groups and rebalancing at scale.' },
    { postId: '6a75a41221a9752ec47bc6e3', title: 'Go Microservices with Kafka', body: 'Event driven services written in go.' },
    { postId: '6a75a41221a9752ec47bc6e4', title: 'Kubernetes Deployment Guide', body: 'Deploying containers to a kubernetes cluster.' },
];

// Questions that must be answerable from the seeded corpus.
const QUESTIONS = [
    'how do you run ollama locally',
    'what is qdrant vector search',
    'how do redis caching patterns work',
    'how do you scale kafka consumers',
    'how do you deploy with kubernetes',
    'how do you write go microservices with kafka',
    'what is cache invalidation with redis',
];

const chatDuration = new Trend('chat_duration', true);

export function setup() {
    ensureConnected();
    for (const post of SEED_POSTS) {
        const res = client.invoke('ai.AIService/IndexPost', {
            postId: post.postId,
            title: post.title,
            body: post.body,
            summary: '',
            tags: [],
            createdAt: '2026-01-01T00:00:00Z',
        });
        if (res.status !== grpc.StatusOK) {
            throw new Error(`seeding ${post.postId} failed: ${res.error.message}`);
        }
    }
}

function askChat(query, threadId) {
    // Server streaming is event based: handlers only run while the
    // default function awaits, so the whole call is wrapped in a promise.
    const stream = new grpc.Stream(client, 'ai.AIService/ChatAnswer');
    return new Promise((resolve) => {
        let cited = null;
        let sawDone = false;
        stream.on('data', (chunk) => {
            if (chunk.done) {
                sawDone = true;
                cited = chunk.citedPostIds || [];
            }
        });
        stream.on('error', (err) => {
            resolve({ ok: false, sawDone, cited, error: err.message });
        });
        stream.on('end', () => {
            resolve({ ok: true, sawDone, cited });
        });
        stream.write({ query, topK: 5, threadId });
    });
}

export default async function () {
    ensureConnected();
    const iter = __ITER;
    // Every VU owns one persistent conversation: iterations chain into a
    // growing checkpointed session (thread_id), which also drives history
    // compaction under sustained load.
    const threadId = 'chat-vu-' + __VU;
    const query = QUESTIONS[iter % QUESTIONS.length];

    const start = Date.now();
    const outcome = await askChat(query, threadId);
    chatDuration.add(Date.now() - start);

    check(outcome, {
        'chat stream completes': (r) => r.ok,
        'chat stream reports citations': (r) => r.ok && r.sawDone && Array.isArray(r.cited),
    });

    // The graph rewrites queries before hybrid retrieval, so even
    // unrelated input lands somewhere in the corpus and resolves
    // citations through the fallback; there is no stateless-era
    // "uncited" case left to assert. Grounding quality is covered by
    // the eval suites instead.
    const embeddingMode = __ENV.EMBEDDING_MODE || 'fake';
    if (embeddingMode === 'ollama') {
        check(outcome, {
            'chat cites retrieved posts': (r) => r.ok && r.cited.length > 0,
        });
    }
}
