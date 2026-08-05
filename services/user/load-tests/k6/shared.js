import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.TARGET || 'http://user-service:4001';
const GRAPHQL_PATH = `${BASE_URL}/graphql`;

export const SEED_USERS = parseInt(__ENV.SEED_USERS) || 100;

export function postGraphQL(query, variables, headers, tags) {
  const body = JSON.stringify({ query, variables: variables || {} });
  const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
  return http.post(GRAPHQL_PATH, body, { headers: h, tags });
}

export function checkOk(res, name) {
  return check(res, {
    [`${name} status 200`]: (r) => r.status === 200,
    [`${name} no http error`]: (r) => r.error_code === 0,
    [`${name} no graphql errors`]: (r) => {
      if (r.status !== 200) return true;
      try {
        return !JSON.parse(r.body).errors;
      } catch (_) {
        return false;
      }
    },
  });
}

export function parseBody(res) {
  try {
    return JSON.parse(res.body);
  } catch (_) {
    return null;
  }
}

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
      'http_req_duration{group:signup}': ['p(95)<1000', 'p(99)<3000'],
      'http_req_duration{group:signin}': ['p(95)<1000', 'p(99)<3000'],
      'http_req_duration{group:me}': ['p(95)<300', 'p(99)<1000'],
      'http_req_duration{group:users}': ['p(95)<300', 'p(99)<1000'],
      'http_req_duration{group:user}': ['p(95)<300', 'p(99)<1000'],
      'http_req_duration{group:updateProfile}': ['p(95)<300', 'p(99)<1000'],
      'http_req_failed': ['rate<0.01'],
    },
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}

const ME_QUERY = `query Me { me { id username email } }`;
const USERS_QUERY = `query Users($limit: Int) { users(limit: $limit) { id username } }`;
const USER_QUERY = `query User($id: ID!) { user(id: $id) { id username } }`;
const SIGNUP_MUTATION = `
  mutation Signup($email: String!, $username: String!, $password: String!) {
    signup(email: $email, username: $username, password: $password) {
      token
      user { id }
    }
  }
`;
const SIGNIN_MUTATION = `
  mutation Signin($email: String!, $password: String!) {
    signin(email: $email, password: $password) { token }
  }
`;
const UPDATE_PROFILE_MUTATION = `
  mutation UpdateProfile($name: String, $bio: String) {
    updateProfile(name: $name, bio: $bio) { id }
  }
`;

export const queries = { ME_QUERY, USERS_QUERY, USER_QUERY, SIGNUP_MUTATION, SIGNIN_MUTATION, UPDATE_PROFILE_MUTATION };

// Seeds SEED_USERS via the API in setup(); returns their credentials.
export function seedUsers() {
  const users = [];
  for (let i = 0; i < SEED_USERS; i++) {
    const email = `seed${i}@loadtest.topos`;
    const password = `LoadTestPass${i}1`;
    const res = postGraphQL(
      SIGNUP_MUTATION,
      { email, username: `seed_${i}`, password },
      {},
      { group: 'signup' },
    );
    const body = parseBody(res);
    if (!body || body.errors || !body.data || !body.data.signup) {
      throw new Error(`seed user ${i} failed: ${JSON.stringify(body && body.errors)}`);
    }
    users.push({ id: body.data.signup.user.id, email, password, token: body.data.signup.token });
  }
  return users;
}

// Deterministic per-VU/per-iteration index, unique for the first 1000 iters per VU.
export function iterIndex() {
  return (__VU - 1) * 1000 + __ITER;
}

export function randomEmail(index) {
  return `lt${index}_${Math.floor(Math.random() * 100000)}@loadtest.topos`;
}

export function signupVars(index) {
  const email = randomEmail(index);
  const username = `lt_${index}_${Math.floor(Math.random() * 100000)}`.slice(0, 30);
  const password = `LoadTestPass${index}1`;
  return { email, username, password };
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
