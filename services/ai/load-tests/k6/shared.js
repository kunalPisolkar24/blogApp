import grpc from 'k6/net/grpc';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'ai-service:50051';

export const summaryDuration = new Trend('summary_duration', true);
export const tagsDuration = new Trend('tags_duration', true);
export const postDuration = new Trend('post_duration', true);

export const client = new grpc.Client();
client.load(['/proto/ai'], 'ai_service.proto');

// k6 module state is per-VU, so each VU connects once and reuses the connection.
let connected = false;

export function ensureConnected() {
    if (!connected) {
        client.connect(TARGET, { plaintext: true, timeout: '5s' });
        connected = true;
    }
}

export function getDefaultOptions({ vus, duration, rps }) {
    return {
        scenarios: {
            default: {
                executor: 'constant-arrival-rate',
                rate: rps,
                timeUnit: '1s',
                duration: duration,
                preAllocatedVUs: vus,
                maxVUs: vus * 2,
            },
        },
        thresholds: {
            grpc_req_duration: ['p(95)<100', 'p(99)<250'],
        },
        summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    };
}

export function checkOk(res, name) {
    return check(res, {
        [`${name} status OK`]: (r) => r.status === grpc.StatusOK,
    });
}

const BODY_SENTENCE = (
    'Topos is a content platform where writers publish, readers discover, ' +
    'and teams collaborate around long-form articles. '
);

export function summaryText(index) {
    return `Article ${index}. `.repeat(120);
}

export function tagsPayload(index) {
    return {
        title: `Load Test Article ${index % 1000}`,
        body: BODY_SENTENCE.repeat(10),
    };
}

export function postPayload(index) {
    return {
        prompt:
            `Write a detailed engineering blog post about distributed systems ` +
            `and event-driven architecture (iteration ${index}). Include ` +
            `practical examples, tradeoffs, and a short conclusion.`,
    };
}

export function parseWeights(spec) {
    const weights = [];
    for (const part of spec.split(',')) {
        const [name, weight] = part.split(':');
        weights.push({ name, weight: parseFloat(weight) });
    }
    return weights;
}

export function pickWeighted(weights, rnd) {
    const total = weights.reduce((sum, w) => sum + w.weight, 0);
    let cursor = rnd * total;
    for (const w of weights) {
        cursor -= w.weight;
        if (cursor <= 0) return w.name;
    }
    return weights[weights.length - 1].name;
}

// --- Recommend corpus ---
// Shared by the recommend and surprise scenarios: 6 tagged posts plus an
// identical-text twin for each of the 3 posts the profiled user interacts
// with. Twins are never seen and score ~1.0 against the profile (exact
// text match under fake embeddings, and the profile is the weighted
// average of their originals under real ones), so feeds are always
// non-empty and their content is deterministic. Seeds use a live
// timestamp because feeds only rank posts within RECOMMEND_RECENCY_DAYS.

export const RECOMMEND_SEED_POSTS = [
    { postId: '6a75a41221a9752ec47bc6df', title: 'Running Ollama Locally', body: 'How to run ollama on your own machine.', tags: ['ollama', 'llm'] },
    { postId: '6a75a41221a9752ec47bc6e0', title: 'Qdrant Vector Search Guide', body: 'Hybrid search with dense and sparse vectors.', tags: ['qdrant', 'vector'] },
    { postId: '6a75a41221a9752ec47bc6e1', title: 'Redis Caching Patterns', body: 'Cache invalidation strategies with redis.', tags: ['redis', 'cache'] },
    { postId: '6a75a41221a9752ec47bc6e2', title: 'Scaling Kafka Consumers', body: 'Consumer groups and rebalancing at scale.', tags: ['kafka', 'streaming'] },
    { postId: '6a75a41221a9752ec47bc6e3', title: 'Go Microservices with Kafka', body: 'Event driven services written in go.', tags: ['go', 'kafka'] },
    { postId: '6a75a41221a9752ec47bc6e4', title: 'Kubernetes Deployment Guide', body: 'Deploying containers to a kubernetes cluster.', tags: ['kubernetes', 'deployment'] },
];

export const RECOMMEND_PROFILE_USER = 'c9b2a6e4-9f7d-4b2e-a1c3-5f6d7e8a9b0c';
export const RECOMMEND_COLD_START_USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const RECOMMEND_INTERACTED = RECOMMEND_SEED_POSTS.slice(0, 3);
export const RECOMMEND_SEEN_POST_IDS = RECOMMEND_INTERACTED.map((post) => post.postId);

const RECOMMEND_TWIN_POSTS = RECOMMEND_INTERACTED.map((post, i) => ({
    ...post,
    postId: `6a75a41221a9752ec47bc7${String(i).padStart(2, '0')}`,
}));

// VIEW, LIKE and SAVE fold the post's vector and tags into the user's
// profile with weights 1/3/5; the three interacted posts land in the
// seen list, so a correct feed must never return them.
export function seedRecommendCorpus() {
    ensureConnected();
    const now = new Date().toISOString();
    for (const post of [...RECOMMEND_SEED_POSTS, ...RECOMMEND_TWIN_POSTS]) {
        const res = client.invoke('ai.AIService/IndexPost', {
            postId: post.postId,
            title: post.title,
            body: post.body,
            summary: '',
            tags: post.tags,
            createdAt: now,
        });
        if (res.status !== grpc.StatusOK) {
            throw new Error(`seeding ${post.postId} failed: ${res.error.message}`);
        }
    }

    const kinds = [1, 2, 3];
    for (const [i, post] of RECOMMEND_INTERACTED.entries()) {
        const res = client.invoke('ai.AIService/UpdateUserProfile', {
            userId: RECOMMEND_PROFILE_USER,
            postId: post.postId,
            kind: kinds[i],
        });
        if (res.status !== grpc.StatusOK) {
            throw new Error(`seeding profile for ${post.postId} failed: ${res.error.message}`);
        }
    }
}
