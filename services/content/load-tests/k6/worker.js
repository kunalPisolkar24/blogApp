import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const METRICS_URL = __ENV.TARGET || 'http://content-worker:4003/metrics';
const SEARCH_METRICS_URL = __ENV.TARGET_SEARCH || 'http://content-search-worker:4004/metrics';
const PERSONALIZER_METRICS_URL = __ENV.TARGET_PERSONALIZER || 'http://content-personalizer:4005/metrics';

const vus = parseInt(__ENV.VUS) || 5;
const duration = __ENV.DURATION || '30s';

const workerLag = new Trend('worker_lag', true);
const workerSkipped = new Trend('worker_skipped', true);
const workerFailed = new Trend('worker_failed', true);
const searchWorkerLag = new Trend('search_worker_lag', true);
const searchIndexed = new Trend('search_indexed', true);
const searchDlq = new Trend('search_dlq', true);
const personalizerLag = new Trend('personalizer_lag', true);
const personalizerUpdated = new Trend('personalizer_updated', true);
const personalizerDlq = new Trend('personalizer_dlq', true);

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
        'personalizer_lag': ['p(95)<500'],
        'personalizer_updated': ['max>0'],
        'personalizer_dlq': ['max<1'],
    },
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
    const res = http.get(METRICS_URL);
    const searchRes = http.get(SEARCH_METRICS_URL);
    const personalizerRes = http.get(PERSONALIZER_METRICS_URL);

    check(res, {
        'metrics status 200': (r) => r.status === 200,
    });
    check(searchRes, {
        'search worker metrics status 200': (r) => r.status === 200,
    });
    check(personalizerRes, {
        'personalizer metrics status 200': (r) => r.status === 200,
    });

    // A request that fails yields no body; bail out per endpoint so one
    // downed worker never crashes the whole iteration. The lag gauge is
    // only reported every few seconds, so it may be absent on early
    // scrapes; the counter trends always record.
    if (res.status === 200) {
        const lag = matchGauge(res.body, 'content_worker_consumer_lag');
        const skipped = matchCounter(res.body, 'content_worker_messages_total', 'skipped');
        const failed = matchCounter(res.body, 'content_worker_messages_total', 'failed');
        if (lag !== null) {
            workerLag.add(lag);
        }
        workerSkipped.add(skipped);
        workerFailed.add(failed);
    }

    if (searchRes.status === 200) {
        const searchLag = matchGauge(searchRes.body, 'content_worker_consumer_lag');
        const indexed = matchCounter(searchRes.body, 'content_worker_messages_total', 'completed');
        const dlq = matchCounter(searchRes.body, 'content_worker_messages_total', 'dlq');
        if (searchLag !== null) {
            searchWorkerLag.add(searchLag);
        }
        searchIndexed.add(indexed);
        searchDlq.add(dlq);
    }

    if (personalizerRes.status === 200) {
        const personalizerLagValue = matchGauge(personalizerRes.body, 'content_worker_consumer_lag');
        const updated = matchCounter(personalizerRes.body, 'content_worker_messages_total', 'completed');
        const personalizerDlqValue = matchCounter(personalizerRes.body, 'content_worker_messages_total', 'dlq');
        if (personalizerLagValue !== null) {
            personalizerLag.add(personalizerLagValue);
        }
        personalizerUpdated.add(updated);
        personalizerDlq.add(personalizerDlqValue);
    }
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
