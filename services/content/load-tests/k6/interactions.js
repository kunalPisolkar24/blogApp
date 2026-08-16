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

// Each VU cycles through the three interaction kinds, so the mix stays
// 1:1:1 and every VU gets a fresh post per iteration (toggles never
// collide with an earlier iteration of the same VU).
export default function (data) {
    const token = mintToken(`u_vu_${__VU}`);
    const postId = pick(data.ids, __ITER);
    const start = Date.now();

    const step = __ITER % 3;
    const mutation = step === 0 ? VIEW_MUTATION : step === 1 ? LIKE_MUTATION : SAVE_MUTATION;
    const name = step === 0 ? 'view' : step === 1 ? 'like' : 'save';

    const res = postGraphQL(mutation, { postId }, token, 'write');
    checkOk(res, `interact_${name}`);
    writeDuration.add(Date.now() - start);
}