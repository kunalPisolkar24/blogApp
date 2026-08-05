import {
  postGraphQL,
  checkOk,
  seedUsers,
  iterIndex,
  signupVars,
  parseWeights,
  pickWeighted,
  getDefaultOptions,
  queries,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;
const weights = parseWeights(__ENV.WEIGHTS || 'users:30,user:15,me:20,signin:20,updateProfile:10,signup:5');

export const options = getDefaultOptions({ vus, duration, rps });

export function setup() {
  return seedUsers();
}

export default function (users) {
  const idx = iterIndex();

  switch (pickWeighted(weights, Math.random())) {
    case 'signup': {
      const res = postGraphQL(queries.SIGNUP_MUTATION, signupVars(idx), {}, { group: 'signup' });
      checkOk(res, 'signup');
      break;
    }
    case 'signin': {
      const u = users[idx % users.length];
      const res = postGraphQL(
        queries.SIGNIN_MUTATION,
        { email: u.email, password: u.password },
        {},
        { group: 'signin' },
      );
      checkOk(res, 'signin');
      break;
    }
    case 'me': {
      const token = users[idx % users.length].token;
      const res = postGraphQL(
        queries.ME_QUERY,
        {},
        { Authorization: `Bearer ${token}` },
        { group: 'me' },
      );
      checkOk(res, 'me');
      break;
    }
    case 'users': {
      const limit = [10, 20, 50][idx % 3];
      const res = postGraphQL(queries.USERS_QUERY, { limit }, {}, { group: 'users' });
      checkOk(res, 'users');
      break;
    }
    case 'user': {
      const id = users[idx % users.length].id;
      const res = postGraphQL(queries.USER_QUERY, { id }, {}, { group: 'user' });
      checkOk(res, 'user');
      break;
    }
    case 'updateProfile': {
      const token = users[idx % users.length].token;
      const res = postGraphQL(
        queries.UPDATE_PROFILE_MUTATION,
        { name: `Load Test User ${idx}`, bio: 'profile updated under load' },
        { Authorization: `Bearer ${token}` },
        { group: 'updateProfile' },
      );
      checkOk(res, 'updateProfile');
      break;
    }
  }
}
