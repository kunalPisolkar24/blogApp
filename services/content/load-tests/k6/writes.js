import {
    checkOk,
    createPayload,
    getDefaultOptions,
    mintToken,
    pick,
    postGraphQL,
    setupSeed,
    updatePayload,
    writeDuration,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 30;

export const options = getDefaultOptions({ vus, duration, rps });

export function setup() {
    return setupSeed();
}

const CREATE_MUTATION = `
    mutation($input: CreatePostInput!) { createPost(input: $input) { id } }
`;

const UPDATE_MUTATION = `
    mutation($id: ID!, $input: UpdatePostInput!) { updatePost(id: $id, input: $input) { id } }
`;

const DELETE_MUTATION = `
    mutation($id: ID!) { deletePost(id: $id) }
`;

// Posts created by this VU during the run; updates and deletes only touch
// these, so the seeded dataset stays stable.
const owned = [];

export default function () {
    const token = mintToken(`u_vu_${__VU}`);
    const start = Date.now();
    let res;

    if (owned.length < 3) {
        res = postGraphQL(CREATE_MUTATION, createPayload(__ITER + 300000), token, 'write');
        if (checkOk(res, 'create')) {
            owned.push(JSON.parse(res.body).data.createPost.id);
        }
    } else if (Math.random() < 0.3) {
        const id = owned.pop();
        res = postGraphQL(DELETE_MUTATION, { id }, token, 'write');
        checkOk(res, 'delete');
    } else {
        res = postGraphQL(UPDATE_MUTATION, { id: pick(owned, __ITER), ...updatePayload(__ITER) }, token, 'write');
        checkOk(res, 'update');
    }

    writeDuration.add(Date.now() - start);
}
