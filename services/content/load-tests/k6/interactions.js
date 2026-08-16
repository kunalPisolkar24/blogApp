import { check } from 'k6';
import {
    checkOk,
    getDefaultOptions,
    mintToken,
    pick,
    postGraphQL,
    setupSeed,
    writeDuration,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;

export const options = getDefaultOptions({ vus, duration, rps });

export function setup() {
    return setupSeed();
}

const VIEW_MUTATION = `
    mutation($postId: ID!) { recordPostView(postId: $postId) }
`;

const LIKE_MUTATION = `
    mutation($postId: ID!) { likePost(postId: $postId) }
`;

const SAVE_MUTATION = `
    mutation($postId: ID!) { savePost(postId: $postId) }
`;

// The state read covers a page of posts with the per-user interaction
// fields, so the batched likedByMe/savedByMe lookups are exercised
// under load, not just the toggles.
const STATE_QUERY = `
    query($page: Int, $limit: Int) {
        posts(page: $page, limit: $limit) {
            posts { id likedByMe savedByMe }
        }
    }
`;

const PAGE_SIZE = 6;

// Each VU cycles through the three interaction kinds, so the mix stays
// 1:1:1 and every VU gets a fresh post per iteration (toggles never
// collide with an earlier iteration of the same VU). Every interaction
// is followed by a state read of the page containing that post, which
// verifies the toggle landed and exercises the per-request batcher.
export default function (data) {
    const token = mintToken(`u_vu_${__VU}`);
    const postId = pick(data.ids, __ITER);
    const start = Date.now();

    const step = __ITER % 3;
    const mutation = step === 0 ? VIEW_MUTATION : step === 1 ? LIKE_MUTATION : SAVE_MUTATION;
    const name = step === 0 ? 'view' : step === 1 ? 'like' : 'save';

    const res = postGraphQL(mutation, { postId }, token, 'write');
    checkOk(res, `interact_${name}`);

    const read = postGraphQL(
        STATE_QUERY,
        stateQueryFor(data.ids.length, __ITER),
        token,
        'read',
    );
    checkState(read, postId, step);
    writeDuration.add(Date.now() - start);
}

// stateQueryFor builds the variables for the page that must contain the
// post at ids[iteration]. posts() returns newest first while the seeded
// ids are oldest first, so that post sits at position
// postCount - 1 - iteration within the full list.
function stateQueryFor(postCount, iteration) {
    const position = postCount - 1 - (iteration % postCount);
    return { page: Math.floor(position / PAGE_SIZE) + 1, limit: PAGE_SIZE };
}

// checkState verifies the post appears on the read page with the state
// the just-run interaction must have produced. The view step never
// changes likedByMe/savedByMe, so only the shape of its state is
// checked; like/save toggles must be reflected immediately.
function checkState(read, postId, step) {
    let body = {};
    try {
        body = JSON.parse(read.body);
    } catch (_) {
        // fall through to the status checks below
    }
    const posts = body?.data?.posts?.posts ?? [];
    const post = posts.find((p) => p.id === postId);

    return check(read, {
        'state read status 200': (r) => r.status === 200,
        'state read no graphql errors': () => !body.errors || body.errors.length === 0,
        'state read contains the post': () => post !== undefined,
        'likedByMe is a boolean': () => typeof post?.likedByMe === 'boolean',
        'savedByMe is a boolean': () => typeof post?.savedByMe === 'boolean',
        'like toggle reflected': () => step !== 1 || post?.likedByMe === true,
        'save toggle reflected': () => step !== 2 || post?.savedByMe === true,
    });
}