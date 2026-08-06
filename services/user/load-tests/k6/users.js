import {
  postGraphQL,
  checkOk,
  seedUsers,
  iterIndex,
  getDefaultOptions,
  queries,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;

export const options = getDefaultOptions({ vus, duration, rps });

export function setup() {
  return seedUsers();
}

export default function (users) {
  const idx = iterIndex();
  // 70% list pagination, 30% single fetch by id.
  if (idx % 10 < 7) {
    const limit = [10, 20, 50][idx % 3];
    const res = postGraphQL(queries.USERS_QUERY, { limit }, {}, { group: 'users' });
    checkOk(res, 'users');
  } else {
    const id = users[idx % users.length].id;
    const res = postGraphQL(queries.USER_QUERY, { id }, {}, { group: 'user' });
    checkOk(res, 'user');
  }
}
