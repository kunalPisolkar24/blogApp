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

// RecommendFeed ranks against the stored user profile, so each call is a
// real store roundtrip (no LLM, no embedding at read time). In qdrant
// mode the surprise feed relaxes its score threshold over many
// roundtrips, so the Makefile widens these for VECTOR_MODE=qdrant.
const recommendP95 = parseInt(__ENV.RECOMMEND_P95) || 250;
const recommendP99 = parseInt(__ENV.RECOMMEND_P99) || 600;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        grpc_req_duration: [`p(95)<${recommendP95}`, `p(99)<${recommendP99}`],
    },
};

// Seeds must be created within RECOMMEND_RECENCY_DAYS of the request, so
// they use a live timestamp instead of the fixed dates other scenarios
// rely on.
const SEED_POSTS = [
    { postId: '6a75a41221a9752ec47bc6df', title: 'Running Ollama Locally', body: 'How to run ollama on your own machine.', tags: ['ollama', 'llm'] },
    { postId: '6a75a41221a9752ec47bc6e0', title: 'Qdrant Vector Search Guide', body: 'Hybrid search with dense and sparse vectors.', tags: ['qdrant', 'vector'] },
    { postId: '6a75a41221a9752ec47bc6e1', title: 'Redis Caching Patterns', body: 'Cache invalidation strategies with redis.', tags: ['redis', 'cache'] },
    { postId: '6a75a41221a9752ec47bc6e2', title: 'Scaling Kafka Consumers', body: 'Consumer groups and rebalancing at scale.', tags: ['kafka', 'streaming'] },
    { postId: '6a75a41221a9752ec47bc6e3', title: 'Go Microservices with Kafka', body: 'Event driven services written in go.', tags: ['go', 'kafka'] },
    { postId: '6a75a41221a9752ec47bc6e4', title: 'Kubernetes Deployment Guide', body: 'Deploying containers to a kubernetes cluster.', tags: ['kubernetes', 'deployment'] },
];

// The profiled user interacts with the first three posts; each has a twin
// with identical text below. The twins are never seen, score ~1.0 against
// the profile (exact text match under fake embeddings, and the profile is
// the weighted average of their originals under real ones), so the feed is
// always non-empty and its content is deterministic.
const INTERACTED = SEED_POSTS.slice(0, 3);
const SEEN_POST_IDS = INTERACTED.map((post) => post.postId);

function twinPostId(index) {
    return `6a75a41221a9752ec47bc7${String(index).padStart(2, '0')}`;
}

const TWIN_POSTS = INTERACTED.map((post, i) => ({
    ...post,
    postId: twinPostId(i),
}));

const PROFILE_USER = 'c9b2a6e4-9f7d-4b2e-a1c3-5f6d7e8a9b0c';
const COLD_START_USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

export function setup() {
    ensureConnected();
    const now = new Date().toISOString();
    for (const post of [...SEED_POSTS, ...TWIN_POSTS]) {
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

    // VIEW, LIKE and SAVE fold the post's vector and tags into the user's
    // profile with weights 1/3/5; the three interacted posts land in the
    // seen list, so a correct feed must never return them.
    const kinds = [1, 2, 3];
    for (const [i, post] of INTERACTED.entries()) {
        const res = client.invoke('ai.AIService/UpdateUserProfile', {
            userId: PROFILE_USER,
            postId: post.postId,
            kind: kinds[i],
        });
        if (res.status !== grpc.StatusOK) {
            throw new Error(`seeding profile for ${post.postId} failed: ${res.error.message}`);
        }
    }
}

export default function () {
    ensureConnected();
    const iter = __ITER;

    const res = client.invoke('ai.AIService/RecommendFeed', {
        userId: PROFILE_USER,
        offset: 0,
        limit: 10,
        mode: 1, // DEFAULT
    });
    checkOk(res, 'recommend');
    check(res, {
        'feed ranks the user taste': (r) =>
            r.status === grpc.StatusOK && r.message.total > 0,
        'feed excludes seen posts': (r) =>
            r.status === grpc.StatusOK &&
            !r.message.postIds.some((id) => SEEN_POST_IDS.includes(id)),
    });

    // Every 10th iteration also exercises surprise mode: the same seed
    // must produce the same ordering, and a user with no profile at all
    // stays cold-started with an empty feed.
    if (iter % 10 === 9) {
        const surprise = client.invoke('ai.AIService/RecommendFeed', {
            userId: PROFILE_USER,
            offset: 0,
            limit: 10,
            mode: 2, // SURPRISE
            seed: 42,
        });
        const repeated = client.invoke('ai.AIService/RecommendFeed', {
            userId: PROFILE_USER,
            offset: 0,
            limit: 10,
            mode: 2, // SURPRISE
            seed: 42,
        });
        checkOk(surprise, 'surprise');
        checkOk(repeated, 'surprise');
        check(surprise, {
            'surprise excludes seen posts': (r) =>
                r.status === grpc.StatusOK &&
                !r.message.postIds.some((id) => SEEN_POST_IDS.includes(id)),
            'same seed gives the same order': (r) =>
                r.status === grpc.StatusOK &&
                repeated.status === grpc.StatusOK &&
                JSON.stringify(r.message.postIds) === JSON.stringify(repeated.message.postIds),
        });

        const cold = client.invoke('ai.AIService/RecommendFeed', {
            userId: COLD_START_USER,
            offset: 0,
            limit: 10,
            mode: 2, // SURPRISE
            seed: 42,
        });
        checkOk(cold, 'cold start');
        check(cold, {
            'cold-start user gets an empty feed': (r) =>
                r.status === grpc.StatusOK && r.message.total === 0,
        });
    }
}