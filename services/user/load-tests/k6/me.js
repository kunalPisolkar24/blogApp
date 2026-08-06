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
  const token = users[iterIndex() % users.length].token;
  const res = postGraphQL(
    queries.ME_QUERY,
    {},
    { Authorization: `Bearer ${token}` },
    { group: 'me' },
  );
  checkOk(res, 'me');
}
