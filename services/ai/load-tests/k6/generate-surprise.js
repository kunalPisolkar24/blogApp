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

// Surprise feeds relax their score threshold over many store roundtrips
// in qdrant mode, so the Makefile widens these for VECTOR_MODE=qdrant;
// fake mode stays service-bound.
const surpriseP95 = parseInt(__ENV.SURPRISE_P95) || 250;
const surpriseP99 = parseInt(__ENV.SURPRISE_P99) || 600;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        grpc_req_duration: [`p(95)<${surpriseP95}`, `p(99)<${surpriseP99}`],
    },
};

export function setup() {
    seedRecommendCorpus();
}

export default function () {
    ensureConnected();
    const seed = 42;

    // The negated profile scores the interacted posts' twins below even
    // the surprise floor, so a correct surprise feed ranks the unrelated
    // posts instead of the user's obvious taste. Calling twice with the
    // same seed must produce the same ordering.
    const surprise = client.invoke('ai.AIService/RecommendFeed', {
        userId: RECOMMEND_PROFILE_USER,
        offset: 0,
        limit: 10,
        mode: 2, // SURPRISE
        seed,
    });
    const repeated = client.invoke('ai.AIService/RecommendFeed', {
        userId: RECOMMEND_PROFILE_USER,
        offset: 0,
        limit: 10,
        mode: 2, // SURPRISE
        seed,
    });
    checkOk(surprise, 'surprise');
    checkOk(repeated, 'surprise');
    check(surprise, {
        'surprise feed ranks posts': (r) =>
            r.status === grpc.StatusOK && r.message.postIds.length > 0,
        'surprise excludes seen posts': (r) =>
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
            mode: 2, // SURPRISE
            seed,
        });
        checkOk(cold, 'cold start');
        check(cold, {
            'cold-start user gets an empty feed': (r) =>
                r.status === grpc.StatusOK && r.message.total === 0,
        });
    }
}