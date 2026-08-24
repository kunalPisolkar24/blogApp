import grpc from 'k6/net/grpc';
import { check } from 'k6';
import {
    RECOMMEND_COLD_START_USER,
    RECOMMEND_PROFILE_USER,
    RECOMMEND_SEEN_POST_IDS,
    checkOk,
    client,
    ensureConnected,
    getDefaultOptions,
    seedRecommendCorpus,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 100;

// Fresh feeds run the same single-store-query shape as recommend, just
// with a shorter recency window, so they share the plain budget.
const freshP95 = parseInt(__ENV.FRESH_P95) || 250;
const freshP99 = parseInt(__ENV.FRESH_P99) || 600;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        grpc_req_duration: [`p(95)<${freshP95}`, `p(99)<${freshP99}`],
    },
};

export function setup() {
    seedRecommendCorpus();
}

export default function () {
    ensureConnected();

    // Fresh mode narrows the recency window; ordering stays deterministic
    // without a seed because no shuffle is involved.
    const fresh = client.invoke('ai.AIService/RecommendFeed', {
        userId: RECOMMEND_PROFILE_USER,
        offset: 0,
        limit: 10,
        mode: 3, // FRESH
    });
    checkOk(fresh, 'fresh');
    check(fresh, {
        'fresh feed ranks posts': (r) =>
            r.status === grpc.StatusOK && r.message.postIds.length > 0,
        'fresh excludes seen posts': (r) =>
            r.status === grpc.StatusOK &&
            !r.message.postIds.some((id) => RECOMMEND_SEEN_POST_IDS.includes(id)),
    });

    // Every 10th iteration also checks the cold-start path.
    if (__ITER % 10 === 9) {
        const cold = client.invoke('ai.AIService/RecommendFeed', {
            userId: RECOMMEND_COLD_START_USER,
            offset: 0,
            limit: 10,
            mode: 3, // FRESH
        });
        checkOk(cold, 'cold start');
        check(cold, {
            'cold-start user gets an empty feed': (r) =>
                r.status === grpc.StatusOK && r.message.total === 0,
        });
    }
}
