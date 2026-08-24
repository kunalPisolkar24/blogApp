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

// Explorer blends a surprise page into the default ranking, and the
// surprise page relaxes its score threshold over store roundtrips in
// qdrant mode, so the Makefile widens these like the surprise budget.
const explorerP95 = parseInt(__ENV.EXPLORER_P95) || 250;
const explorerP99 = parseInt(__ENV.EXPLORER_P99) || 600;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        grpc_req_duration: [`p(95)<${explorerP95}`, `p(99)<${explorerP99}`],
    },
};

export function setup() {
    seedRecommendCorpus();
}

export default function () {
    ensureConnected();
    const seed = 42;

    // Explorer interleaves surprise picks into the taste ranking; the same
    // seed must reproduce the exact blend.
    const explorer = client.invoke('ai.AIService/RecommendFeed', {
        userId: RECOMMEND_PROFILE_USER,
        offset: 0,
        limit: 10,
        mode: 4, // EXPLORER
        seed,
    });
    const repeated = client.invoke('ai.AIService/RecommendFeed', {
        userId: RECOMMEND_PROFILE_USER,
        offset: 0,
        limit: 10,
        mode: 4, // EXPLORER
        seed,
    });
    checkOk(explorer, 'explorer');
    checkOk(repeated, 'explorer');
    check(explorer, {
        'explorer feed ranks posts': (r) =>
            r.status === grpc.StatusOK && r.message.postIds.length > 0,
        'explorer excludes seen posts': (r) =>
            r.status === grpc.StatusOK &&
            !r.message.postIds.some((id) => RECOMMEND_SEEN_POST_IDS.includes(id)),
        'same seed gives the same order': (r) =>
            r.status === grpc.StatusOK &&
            repeated.status === grpc.StatusOK &&
            JSON.stringify(r.message.postIds) === JSON.stringify(repeated.message.postIds),
    });

    // Every 10th iteration also checks the cold-start path.
    if (__ITER % 10 === 9) {
        const cold = client.invoke('ai.AIService/RecommendFeed', {
            userId: RECOMMEND_COLD_START_USER,
            offset: 0,
            limit: 10,
            mode: 4, // EXPLORER
            seed,
        });
        checkOk(cold, 'cold start');
        check(cold, {
            'cold-start user gets an empty feed': (r) =>
                r.status === grpc.StatusOK && r.message.total === 0,
        });
    }
}
