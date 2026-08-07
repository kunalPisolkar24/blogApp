import {
    checkOk,
    client,
    ensureConnected,
    getDefaultOptions,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 100;

export const options = getDefaultOptions({ vus, duration, rps });

const QUERIES = [
    'grpc client setup',
    'kubernetes deployment guide',
    'distributed tracing with opentelemetry',
    'mongodb sharding best practices',
    'kafka event driven architecture',
];

export default function () {
    ensureConnected();
    const query = QUERIES[__ITER % QUERIES.length];
    const res = client.invoke('ai.AIService/SearchPosts', {
        query,
        offset: 0,
        limit: 10,
    });
    checkOk(res, 'search');
}
