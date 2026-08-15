import {
    checkOk,
    createPayload,
    getDefaultOptions,
    mintToken,
    parseWeights,
    pick,
    pickWeighted,
    postGraphQL,
    readDuration,
    setupSeed,
    updatePayload,
    writeDuration,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;
const weights = parseWeights(__ENV.WEIGHTS || 'posts:30,post:20,tag:10,author:10,create:15,update:10,delete:5,chat:5');

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

const CREATE_MUTATION = `
    mutation($input: CreatePostInput!) { createPost(input: $input) { id } }
`;

const UPDATE_MUTATION = `
    mutation($id: ID!, $input: UpdatePostInput!) { updatePost(id: $id, input: $input) { id } }
`;

const DELETE_MUTATION = `
    mutation($id: ID!) { deletePost(id: $id) }
`;

const CREATE_CHAT_MUTATION = `
    mutation($title: String) { createChat(title: $title) { id } }
`;

const ASK_MUTATION = `
    mutation($chatId: ID!, $query: String!) {
        askChat(chatId: $chatId, query: $query) { id content }
    }
`;

// Chat answers are not grounded in this script (no AI indexing step), so
// only the reply round trip is asserted, not citations.
const CHAT_QUESTIONS = [
    'what can you tell me about this platform?',
    'how do I get started here?',
    'what topics are covered?',
];

// Posts created by this VU during the run; updates and deletes only touch
// these, so the seeded dataset stays stable.
const owned = [];
let chatId = null;

export default function (data) {
    const token = mintToken(`u_vu_${__VU}`);
    const op = pickWeighted(weights, Math.random());

    switch (op) {
        case 'posts': {
            const start = Date.now();
            const res = postGraphQL(READ_QUERY, { page: 1 + Math.floor(Math.random() * 10), limit: 10 }, null, 'read');
            readDuration.add(Date.now() - start);
            checkOk(res, 'posts');
            break;
        }
        case 'post': {
            const start = Date.now();
            const res = postGraphQL(POST_QUERY, { id: pick(data.ids, Math.floor(Math.random() * 1e9)) }, null, 'read');
            readDuration.add(Date.now() - start);
            checkOk(res, 'post');
            break;
        }
        case 'tag': {
            const start = Date.now();
            const res = postGraphQL(TAGS_QUERY, { query: pick(data.tags, __ITER), limit: 10 }, null, 'read');
            readDuration.add(Date.now() - start);
            checkOk(res, 'tags');
            break;
        }
        case 'author': {
            const start = Date.now();
            const res = postGraphQL(AUTHOR_QUERY, { id: pick(data.ids, __ITER), page: 1, limit: 10 }, null, 'read');
            readDuration.add(Date.now() - start);
            checkOk(res, 'author posts');
            break;
        }
        case 'create': {
            const start = Date.now();
            const res = postGraphQL(CREATE_MUTATION, createPayload(__ITER + 100000), token, 'write');
            writeDuration.add(Date.now() - start);
            if (checkOk(res, 'create')) {
                const body = JSON.parse(res.body);
                if (body.data && body.data.createPost) {
                    owned.push(body.data.createPost.id);
                }
            }
            break;
        }
        case 'update': {
            if (owned.length === 0) {
                const createRes = postGraphQL(CREATE_MUTATION, createPayload(__ITER + 200000), token, 'write');
                if (checkOk(createRes, 'create')) {
                    owned.push(JSON.parse(createRes.body).data.createPost.id);
                }
                break;
            }
            const start = Date.now();
            const res = postGraphQL(UPDATE_MUTATION, { id: pick(owned, __ITER), ...updatePayload(__ITER) }, token, 'write');
            writeDuration.add(Date.now() - start);
            checkOk(res, 'update');
            break;
        }
        case 'delete': {
            if (owned.length === 0) {
                break;
            }
            const start = Date.now();
            const id = owned.pop();
            const res = postGraphQL(DELETE_MUTATION, { id }, token, 'write');
            writeDuration.add(Date.now() - start);
            checkOk(res, 'delete');
            break;
        }
        case 'chat': {
            if (!chatId) {
                const res = postGraphQL(CREATE_CHAT_MUTATION, {}, token, 'write');
                const body = JSON.parse(res.body);
                if (checkOk(res, 'create chat') && body.data && body.data.createChat) {
                    chatId = body.data.createChat.id;
                }
                break;
            }
            const start = Date.now();
            const res = postGraphQL(
                ASK_MUTATION,
                { chatId, query: CHAT_QUESTIONS[__ITER % CHAT_QUESTIONS.length] },
                token,
                'write',
            );
            writeDuration.add(Date.now() - start);
            if (checkOk(res, 'ask chat')) {
                const body = JSON.parse(res.body);
                check(body, {
                    'chat reply is non-empty': (r) =>
                        r.data && r.data.askChat && r.data.askChat.content.length > 0,
                });
            }
            break;
        }
    }
}
