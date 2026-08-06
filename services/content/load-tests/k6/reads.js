import {
    checkOk,
    getDefaultOptions,
    pick,
    postGraphQL,
    readDuration,
    setupSeed,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;

export const options = getDefaultOptions({ vus, duration, rps });

export function setup() {
    return setupSeed();
}

const READ_QUERY = `
    query Posts($page: Int, $limit: Int) {
        posts(page: $page, limit: $limit) { posts { id title } totalPages }
    }
`;

const POST_QUERY = `
    query Post($id: ID!) {
        post(id: $id) { id title }
    }
`;

const TAGS_QUERY = `
    query Tags($query: String, $limit: Int) {
        tags(query: $query, limit: $limit) { id name }
    }
`;

const AUTHOR_QUERY = `
    query AuthorPosts($id: ID!, $page: Int, $limit: Int) {
        _entities(representations: [{ __typename: "User", id: $id }]) {
            ... on User { posts(page: $page, limit: $limit) { posts { id } } }
        }
    }
`;

export default function (data) {
    const roll = Math.random();
    const start = Date.now();
    let res;

    if (roll < 0.4) {
        res = postGraphQL(READ_QUERY, { page: 1 + Math.floor(Math.random() * 10), limit: 10 }, null, 'read');
    } else if (roll < 0.7) {
        res = postGraphQL(POST_QUERY, { id: pick(data.ids, Math.floor(Math.random() * 1e9)) }, null, 'read');
    } else if (roll < 0.85) {
        res = postGraphQL(TAGS_QUERY, { query: pick(data.tags, __ITER), limit: 10 }, null, 'read');
    } else {
        res = postGraphQL(AUTHOR_QUERY, { id: pick(data.ids, __ITER), page: 1, limit: 10 }, null, 'read');
    }

    readDuration.add(Date.now() - start);
    checkOk(res, 'read');
}
