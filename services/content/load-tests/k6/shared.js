import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const BASE_URL = __ENV.TARGET || 'http://content-service:4002';
const QUERY_PATH = `${BASE_URL}/query`;

export const JWT_SECRET = __ENV.JWT_SECRET || 'local-dev-secret';
export const JWT_ISSUER = __ENV.JWT_ISSUER || 'user-service';
export const JWT_AUDIENCE = __ENV.JWT_AUDIENCE || 'topos';

export const SEED_POST_COUNT = parseInt(__ENV.SEED_POST_COUNT) || 1000;
export const SEED_USERS = parseInt(__ENV.SEED_USERS) || 20;

export const TAG_POOL = ['go', 'web', 'devops', 'ai', 'rust'];
export const MAX_PAGE = Math.max(1, Math.ceil(SEED_POST_COUNT / 10));

export const readDuration = new Trend('read_duration', true);
export const writeDuration = new Trend('write_duration', true);

// --- JWT minting ----------------------------------------------------------

export function mintToken(userID) {
    const header = encoding.b64encode(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
        'rawurl',
    );
    const payload = encoding.b64encode(
        JSON.stringify({
            id: userID,
            iss: JWT_ISSUER,
            aud: JWT_AUDIENCE,
            exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        'rawurl',
    );

    const hmac = crypto.createHMAC('sha256', JWT_SECRET);
    hmac.update(`${header}.${payload}`);
    const signature = hmac.digest('base64rawurl');

    return `${header}.${payload}.${signature}`;
}

// --- GraphQL ---------------------------------------------------------------

export function postGraphQL(query, variables, token, group) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const tags = group ? { group } : {};
    return http.post(QUERY_PATH, JSON.stringify({ query, variables: variables || {} }), {
        headers,
        tags,
    });
}

export function checkOk(res, name) {
    return check(res, {
        [`${name} status 200`]: (r) => r.status === 200,
        [`${name} no http error`]: (r) => r.error_code === 0,
        [`${name} no graphql errors`]: (r) => {
            if (r.status !== 200) return true;
            try {
                const body = JSON.parse(r.body);
                return !body.errors || body.errors.length === 0;
            } catch (_) {
                return false;
            }
        },
    });
}

// --- Payloads ---------------------------------------------------------------

export function createPayload(index) {
    return {
        input: {
            title: `Load Test Article ${index}`,
            body: `<p>Body of load test article ${index}. ${sentence(6)}</p>`,
            tags: [TAG_POOL[index % TAG_POOL.length]],
        },
    };
}

export function updatePayload(index) {
    return {
        input: {
            title: `Load Test Article ${index} (updated)`,
            tags: [TAG_POOL[(index + 1) % TAG_POOL.length]],
        },
    };
}

function sentence(times) {
    return 'Topos is a content platform for long-form writing and discovery. '.repeat(times);
}

// --- Seed setup -------------------------------------------------------------

// setupSeed mints one token per test user and creates SEED_POST_COUNT posts
// through the GraphQL API. The returned ids and tags feed the read scripts.
export function setupSeed() {
    const tokens = [];
    for (let i = 1; i <= SEED_USERS; i++) {
        tokens.push(mintToken(`u_load_${i}`));
    }

    const ids = [];
    const perUser = Math.ceil(SEED_POST_COUNT / SEED_USERS);
    let created = 0;

    for (let u = 0; u < SEED_USERS && created < SEED_POST_COUNT; u++) {
        for (let i = 0; i < perUser && created < SEED_POST_COUNT; i++, created++) {
            const res = postGraphQL(
                `mutation($input: CreatePostInput!) { createPost(input: $input) { id } }`,
                createPayload(created),
                tokens[u],
            );
            if (res.status !== 200) {
                continue;
            }
            const body = JSON.parse(res.body);
            if (body.errors && body.errors.length > 0) {
                continue;
            }
            ids.push(body.data.createPost.id);
        }
    }

    if (ids.length === 0) {
        throw new Error('seeding failed: no posts created');
    }

    console.log(`seeded ${ids.length} posts across ${SEED_USERS} users`);
    return { ids, tags: TAG_POOL };
}

export function pick(list, index) {
    return list[index % list.length];
}

// --- Options -----------------------------------------------------------------

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
            'http_req_failed{group:read}': ['rate<0.01'],
            'http_req_failed{group:write}': ['rate<0.01'],
            'http_req_duration{group:read}': ['p(95)<300', 'p(99)<800'],
            'http_req_duration{group:write}': ['p(95)<500', 'p(99)<1200'],
        },
        summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
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
