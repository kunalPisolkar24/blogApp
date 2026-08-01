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
