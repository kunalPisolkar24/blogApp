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

// Queries that share no words with the corpus; under fake embeddings the
// score threshold filters them out and no citations are expected.
const GIBBERISH_QUERIES = [
    'x7k9l2m4n6p8q1r3',
    'zyzzyvas unrhythmical',
    'q1w2e3r4t5y6u7i8o9p0',
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

function askChat(query) {
    // Server streaming is event based: handlers only run while the
    // default function awaits, so the whole call is wrapped in a promise.
    const stream = new grpc.Stream(client, 'ai.AIService/ChatAnswer');
    return new Promise((resolve) => {
        let cited = [];
        stream.on('data', (chunk) => {
            if (chunk.done) {
                cited = chunk.citedPostIds || [];
            }
        });
        stream.on('error', (err) => {
            resolve({ ok: false, cited, error: err.message });
        });
        stream.on('end', () => {
            resolve({ ok: true, cited });
        });
        stream.write({ query, topK: 5 });
    });
}

export default async function () {
    ensureConnected();
    const iter = __ITER;
    const isGibberish = iter % 10 === 9;
    const query = isGibberish
        ? GIBBERISH_QUERIES[Math.floor(iter / 10) % GIBBERISH_QUERIES.length]
        : QUESTIONS[iter % QUESTIONS.length];

    const start = Date.now();
    const outcome = await askChat(query);
    chatDuration.add(Date.now() - start);

    check(outcome, {
        'chat stream completes': (r) => r.ok,
    });

    // Fake embeddings are exact-match only and the chat retrieval channel
    // is dense-only, so a natural question never scores above the threshold
    // and citations are empty. Under real embeddings the answer must be
    // grounded in the seeded corpus, so the citation check only binds in
    // ollama mode (the smoke script covers the real-LLM case separately).
    const embeddingMode = __ENV.EMBEDDING_MODE || 'fake';
    if (isGibberish) {
        if (embeddingMode === 'fake') {
            check(outcome, {
                'gibberish query yields no citations': (r) => r.ok && r.cited.length === 0,
            });
        }
    } else if (embeddingMode === 'ollama') {
        check(outcome, {
            'chat cites retrieved posts': (r) => r.ok && r.cited.length > 0,
        });
    }
}
