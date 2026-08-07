import grpc from 'k6/net/grpc';
import { check } from 'k6';
import {
    checkOk,
    client,
    ensureConnected,
    getDefaultOptions,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 100;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    // Search does a real Qdrant roundtrip per call, so its latency budget is
    // wider than the fake-LLM RPCs; the thresholds still catch regressions.
    thresholds: {
        grpc_req_duration: ['p(95)<250', 'p(99)<600'],
    },
};

// The seeded posts are indexed once per run in setup(). Fake embeddings
// make exact text matches score ~1.0 and unrelated text ~0.0, so the
// dense score threshold is exercised for real: relevant queries must
// return results and gibberish must return none.
const SEED_POSTS = [
    { postId: '6a75a41221a9752ec47bc6df', title: 'Running Ollama Locally', body: 'How to run ollama on your own machine.' },
    { postId: '6a75a41221a9752ec47bc6e0', title: 'Qdrant Vector Search Guide', body: 'Hybrid search with dense and sparse vectors.' },
    { postId: '6a75a41221a9752ec47bc6e1', title: 'Redis Caching Patterns', body: 'Cache invalidation strategies with redis.' },
    { postId: '6a75a41221a9752ec47bc6e2', title: 'Scaling Kafka Consumers', body: 'Consumer groups and rebalancing at scale.' },
    { postId: '6a75a41221a9752ec47bc6e3', title: 'Go Microservices with Kafka', body: 'Event driven services written in go.' },
    { postId: '6a75a41221a9752ec47bc6e4', title: 'Kubernetes Deployment Guide', body: 'Deploying containers to a kubernetes cluster.' },
];

// Queries that must return at least one result.
const RELEVANT_QUERIES = [
    'Running Ollama Locally',
    'Qdrant Vector Search Guide',
    'Redis Caching Patterns',
    'Scaling Kafka Consumers',
    'kafka consumer groups',
    'kubernetes deployment',
    'cache invalidation with redis',
];

// Queries that share no words with any seeded post and must be filtered
// out by the score threshold.
const GIBBERISH_QUERIES = [
    'x7k9l2m4n6p8q1r3',
    'zyzzyvas unrhythmical',
    'q1w2e3r4t5y6u7i8o9p0',
];

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

export default function () {
    ensureConnected();
    const iter = __ITER;
    const query = iter % 10 === 9
        ? GIBBERISH_QUERIES[Math.floor(iter / 10) % GIBBERISH_QUERIES.length]
        : RELEVANT_QUERIES[iter % RELEVANT_QUERIES.length];

    const res = client.invoke('ai.AIService/SearchPosts', {
        query,
        offset: 0,
        limit: 10,
    });
    checkOk(res, 'search');

    if (iter % 10 === 9) {
        check(res, {
            'gibberish query returns no results': (r) => r.status === grpc.StatusOK && r.message.total === 0,
        });
    } else {
        check(res, {
            'relevant query returns results': (r) => r.status === grpc.StatusOK && r.message.total > 0,
        });
    }
}
