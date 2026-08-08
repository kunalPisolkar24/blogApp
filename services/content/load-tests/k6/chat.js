import grpc from 'k6/net/grpc';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import {
    checkOk,
    getDefaultOptions,
    mintToken,
    parseWeights,
    pickWeighted,
    postGraphQL,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;
const weights = parseWeights(__ENV.WEIGHTS || 'create:10,list:10,messages:20,ask:60');

// AskChat streams an LLM answer per call, so its latency budget is wider
// than the plain GraphQL ops; the Makefile picks generous defaults for
// embedding-ollama and llm-real runs.
const chatP95 = parseInt(__ENV.CHAT_P95) || 500;
const chatP99 = parseInt(__ENV.CHAT_P99) || 1500;

const AI_TARGET = __ENV.TARGET_AI || 'ai-service:50051';

export const options = {
    ...getDefaultOptions({ vus, duration, rps }),
    thresholds: {
        'http_req_failed': ['rate<0.01'],
        'http_req_duration{group:chat}': ['p(95)<300', 'p(99)<800'],
        'http_req_duration{group:ask}': [`p(95)<${chatP95}`, `p(99)<${chatP99}`],
        chat_duration: [`p(95)<${chatP95}`, `p(99)<${chatP99}`],
    },
};

// The same factual corpus as the AI service chat test, so answers are
// grounded in real content under every embedding mode. The posts are
// created through the GraphQL API and then indexed into the AI service
// over gRPC in setup().
const SEED_POSTS = [
    { title: 'Running Ollama Locally', body: 'How to run ollama on your own machine for local inference.' },
    { title: 'Qdrant Vector Search Guide', body: 'Hybrid search with dense and sparse vectors using qdrant.' },
    { title: 'Redis Caching Patterns', body: 'Cache invalidation strategies with redis for hot endpoints.' },
    { title: 'Scaling Kafka Consumers', body: 'Consumer groups and rebalancing kafka partitions at scale.' },
    { title: 'Go Microservices with Kafka', body: 'Event driven microservices written in go with kafka.' },
    { title: 'Kubernetes Deployment Guide', body: 'Deploying containers to a kubernetes cluster with helm.' },
];

// Questions that must be answerable from the seeded corpus.
const QUESTIONS = [
    'how do you run ollama locally on your own machine',
    'what is qdrant hybrid search with dense and sparse vectors',
    'how do redis cache invalidation strategies work',
    'how do you scale kafka consumers with consumer groups',
    'how do you write event driven microservices in go with kafka',
    'how do you deploy containers to a kubernetes cluster',
];

// Queries that share no words with the corpus; under fake embeddings the
// score threshold filters them out and no citations are expected.
const GIBBERISH_QUERIES = [
    'x7k9l2m4n6p8q1r3',
    'zyzzyvas unrhythmical',
    'q1w2e3r4t5y6u7i8o9p0',
];

const CREATE_CHAT_MUTATION = `
    mutation($title: String) { createChat(title: $title) { id } }
`;

const CHATS_QUERY = `
    query { chats { id title } }
`;

const MESSAGES_QUERY = `
    query($chatId: ID!, $page: Int, $limit: Int) {
        chatMessages(chatId: $chatId, page: $page, limit: $limit) {
            messages { id role content citedPostIds } totalMessages
        }
    }
`;

const ASK_MUTATION = `
    mutation($chatId: ID!, $query: String!) {
        askChat(chatId: $chatId, query: $query) { id content citedPostIds }
    }
`;

const chatDuration = new Trend('chat_duration', true);

// Module state is per-VU in k6, so this persists across iterations of
// the same virtual user.
let chatId = null;

export function setup() {
    const token = mintToken('u_chat_seed');
    const postIds = [];
    for (const post of SEED_POSTS) {
        const res = postGraphQL(
            `mutation($input: CreatePostInput!) { createPost(input: $input) { id } }`,
            { input: { title: post.title, body: post.body, tags: ['chat'] } },
            token,
        );
        if (res.status !== 200) {
            throw new Error(`seeding ${post.title} failed: http ${res.status}`);
        }
        const body = JSON.parse(res.body);
        if (body.errors && body.errors.length > 0) {
            throw new Error(`seeding ${post.title} failed: ${body.errors[0].message}`);
        }
        postIds.push(body.data.createPost.id);
    }

    // The gRPC client is only used inside setup(): k6 does not share
    // module state between setup() and the VU iterations.
    const client = new grpc.Client();
    client.load(['/proto/ai/ai_service.proto']);
    client.connect(AI_TARGET, { plaintext: true });
    for (let i = 0; i < postIds.length; i++) {
        const res = client.invoke('ai.AIService/IndexPost', {
            postId: postIds[i],
            title: SEED_POSTS[i].title,
            body: SEED_POSTS[i].body,
            summary: '',
            tags: ['chat'],
            createdAt: '2026-01-01T00:00:00Z',
        });
        if (res.status !== grpc.StatusOK) {
            throw new Error(`indexing ${postIds[i]} failed: ${res.error.message}`);
        }
    }

    return { postIds };
}

// askChat calls the askChat mutation and returns the assistant message,
// or null when the request failed.
function askChat(chatId, query) {
    const start = Date.now();
    const res = postGraphQL(ASK_MUTATION, { chatId, query }, mintToken(`u_vu_${__VU}`), 'ask');
    chatDuration.add(Date.now() - start);
    if (!checkOk(res, 'ask')) {
        return null;
    }
    const body = JSON.parse(res.body);
    return body.data && body.data.askChat ? body.data.askChat : null;
}

function ensureChat() {
    if (!chatId) {
        const res = postGraphQL(CREATE_CHAT_MUTATION, {}, mintToken(`u_vu_${__VU}`), 'chat');
        const body = JSON.parse(res.body);
        if (checkOk(res, 'create chat') && body.data && body.data.createChat) {
            chatId = body.data.createChat.id;
        }
    }
    return chatId;
}

export default function (data) {
    const token = mintToken(`u_vu_${__VU}`);
    const op = pickWeighted(weights, Math.random());
    const currentChat = ensureChat();

    switch (op) {
        case 'create': {
            const res = postGraphQL(CREATE_CHAT_MUTATION, { title: `Load Chat ${__ITER}` }, token, 'chat');
            const body = JSON.parse(res.body);
            if (checkOk(res, 'create chat') && body.data && body.data.createChat) {
                chatId = body.data.createChat.id;
            }
            break;
        }
        case 'list': {
            const res = postGraphQL(CHATS_QUERY, {}, token, 'chat');
            checkOk(res, 'chats');
            break;
        }
        case 'messages': {
            const res = postGraphQL(MESSAGES_QUERY, { chatId: currentChat, page: 1, limit: 10 }, token, 'chat');
            if (checkOk(res, 'chat messages')) {
                const body = JSON.parse(res.body);
                check(body, {
                    'chat messages paginated': (r) => r.data.chatMessages.totalMessages >= 0,
                });
            }
            break;
        }
        case 'ask': {
            const iter = __ITER;
            const isGibberish = iter % 10 === 9;
            const query = isGibberish
                ? GIBBERISH_QUERIES[Math.floor(iter / 10) % GIBBERISH_QUERIES.length]
                : QUESTIONS[iter % QUESTIONS.length];

            const msg = askChat(currentChat, query);

            check(msg, {
                'ask returns an assistant reply': (m) => m !== null && m.content.length > 0,
            });

            // Fake embeddings are exact-match only and the chat retrieval
            // channel is dense-only, so a natural question never scores
            // above the threshold and citations are empty. Under real
            // embeddings the answer must be grounded in the seeded corpus,
            // so the citation check only binds in ollama mode.
            const embeddingMode = __ENV.EMBEDDING_MODE || 'fake';
            if (isGibberish) {
                if (embeddingMode === 'fake') {
                    check(msg, {
                        'gibberish query yields no citations': (m) =>
                            m !== null && m.citedPostIds.length === 0,
                    });
                }
            } else if (embeddingMode === 'ollama') {
                check(msg, {
                    'answer cites retrieved posts': (m) =>
                        m !== null && m.citedPostIds.length > 0,
                });
            }
            break;
        }
    }
}
