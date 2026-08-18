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

// RecommendFeed ranks against the stored user profile, so each call is a
// real store roundtrip (no LLM, no embedding at read time). The default
// feed is one ranking pass, so its budget matches search; the surprise
// scenario has its own wider budget (SURPRISE_P95/P99).
const recommendP95 = parseInt(__ENV.RECOMMEND_P95) || 250;
const recommendP99 = parseInt(__ENV.RECOMMEND_P99) || 600;

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        grpc_req_duration: [`p(95)<${recommendP95}`, `p(99)<${recommendP99}`],
    },
};

export function setup() {
    seedRecommendCorpus();
}

export default function () {
    ensureConnected();

    const res = client.invoke('ai.AIService/RecommendFeed', {
        userId: RECOMMEND_PROFILE_USER,
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
            !r.message.postIds.some((id) => RECOMMEND_SEEN_POST_IDS.includes(id)),
    });

    // Every 10th iteration also checks the cold-start path: a user with
    // no profile gets an empty feed so callers can fall back to recency.
    if (__ITER % 10 === 9) {
        const cold = client.invoke('ai.AIService/RecommendFeed', {
            userId: RECOMMEND_COLD_START_USER,
            offset: 0,
            limit: 10,
            mode: 1, // DEFAULT
        });
        checkOk(cold, 'cold start');
        check(cold, {
            'cold-start user gets an empty feed': (r) =>
                r.status === grpc.StatusOK && r.message.total === 0,
        });
    }
}