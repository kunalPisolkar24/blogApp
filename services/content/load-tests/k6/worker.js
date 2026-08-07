import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const METRICS_URL = __ENV.TARGET || 'http://content-worker:4003/metrics';
const SEARCH_METRICS_URL = __ENV.TARGET_SEARCH || 'http://content-search-worker:4004/metrics';

const vus = parseInt(__ENV.VUS) || 5;
const duration = __ENV.DURATION || '30s';

const workerLag = new Trend('worker_lag', true);
const workerSkipped = new Trend('worker_skipped', true);
const workerFailed = new Trend('worker_failed', true);
const searchWorkerLag = new Trend('search_worker_lag', true);
const searchIndexed = new Trend('search_indexed', true);
const searchDlq = new Trend('search_dlq', true);

export const options = {
    scenarios: {
        default: {
            executor: 'constant-vus',
            vus,
            duration,
        },
    },
    thresholds: {
        'http_req_failed': ['rate<0.01'],
        'worker_lag': ['p(95)<500'],
        'worker_skipped': ['max>0'],
        'worker_failed': ['max<1'],
        'search_worker_lag': ['p(95)<500'],
        'search_indexed': ['max>0'],
        'search_dlq': ['max<1'],
    },
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
    const res = http.get(METRICS_URL);
    const lag = matchGauge(res.body, 'content_worker_consumer_lag');
    const skipped = matchCounter(res.body, 'content_worker_messages_total', 'skipped');
    const failed = matchCounter(res.body, 'content_worker_messages_total', 'failed');

    const searchRes = http.get(SEARCH_METRICS_URL);
    const searchLag = matchGauge(searchRes.body, 'content_worker_consumer_lag');
    const indexed = matchCounter(searchRes.body, 'content_worker_messages_total', 'completed');
    const dlq = matchCounter(searchRes.body, 'content_worker_messages_total', 'dlq');

    check(res, {
        'metrics status 200': (r) => r.status === 200,
    });
    check(searchRes, {
        'search worker metrics status 200': (r) => r.status === 200,
    });
    if (res.status !== 200 || searchRes.status !== 200) {
        return;
    }

    // The lag gauge is only reported every few seconds, so it may be absent
    // on early scrapes; the counter trends always record.
    if (lag !== null) {
        workerLag.add(lag);
    }
    if (searchLag !== null) {
        searchWorkerLag.add(searchLag);
    }
    workerSkipped.add(skipped);
    workerFailed.add(failed);
    searchIndexed.add(indexed);
    searchDlq.add(dlq);
}

// Returns the gauge value, or null when the metric line is missing.
function matchGauge(body, name) {
    const re = new RegExp(`${name}\\{.*?\\}\\s+([0-9.]+)`);
    const m = body.match(re);
    return m ? parseFloat(m[1]) : null;
}

// Counters only appear once incremented; a missing line means zero.
function matchCounter(body, name, label) {
    const re = new RegExp(`${name}\\{result="${label}"\\}\\s+([0-9.]+)`);
    const m = body.match(re);
    return m ? parseFloat(m[1]) : 0;
}
