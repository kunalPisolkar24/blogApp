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

// RelatedPosts queries the stored vector, so each call is a real store
// roundtrip (no LLM, no embedding at read time). Real embedding providers
// only affect the IndexPost seeding in setup(), not the measured RPC.
const searchP95 = parseInt(__ENV.SEARCH_P95) || 250;
const searchP99 = parseInt(__ENV.SEARCH_P99) || 600;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        grpc_req_duration: [`p(95)<${searchP95}`, `p(99)<${searchP99}`],
    },
};

// The seeded posts are indexed once per run in setup(). Every post is
// also indexed under a twin id with identical text, so it always has a
// guaranteed nearest neighbour: exact text matches score ~1.0 under fake
// embeddings and stay on top under real embeddings too. That makes the
// result checks deterministic in both store modes.
const SEED_POSTS = [
    { postId: '6a75a41221a9752ec47bc6df', title: 'Running Ollama Locally', body: 'How to run ollama on your own machine.' },
    { postId: '6a75a41221a9752ec47bc6e0', title: 'Qdrant Vector Search Guide', body: 'Hybrid search with dense and sparse vectors.' },
    { postId: '6a75a41221a9752ec47bc6e1', title: 'Redis Caching Patterns', body: 'Cache invalidation strategies with redis.' },
    { postId: '6a75a41221a9752ec47bc6e2', title: 'Scaling Kafka Consumers', body: 'Consumer groups and rebalancing at scale.' },
    { postId: '6a75a41221a9752ec47bc6e3', title: 'Go Microservices with Kafka', body: 'Event driven services written in go.' },
    { postId: '6a75a41221a9752ec47bc6e4', title: 'Kubernetes Deployment Guide', body: 'Deploying containers to a kubernetes cluster.' },
];

function twinPostId(index) {
    return `6a75a41221a9752ec47bc7${String(index).padStart(2, '0')}`;
}

const TWIN_POSTS = SEED_POSTS.map((post, i) => ({
    ...post,
    postId: twinPostId(i),
}));

export function setup() {
    ensureConnected();
    for (const post of [...SEED_POSTS, ...TWIN_POSTS]) {
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
    const seed = SEED_POSTS[__ITER % SEED_POSTS.length];

    const res = client.invoke('ai.AIService/RelatedPosts', {
        postId: seed.postId,
        limit: 10,
    });
    checkOk(res, 'related');

    check(res, {
        'related returns the twin post': (r) =>
            r.status === grpc.StatusOK &&
            r.message.postIds.length > 0 &&
            r.message.postIds[0] === twinPostId(__ITER % SEED_POSTS.length),
        'related excludes the post itself': (r) =>
            r.status === grpc.StatusOK && !r.message.postIds.includes(seed.postId),
    });
}
