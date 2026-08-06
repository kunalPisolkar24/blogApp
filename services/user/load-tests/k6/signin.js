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
  const u = users[iterIndex() % users.length];
  const res = postGraphQL(
    queries.SIGNIN_MUTATION,
    { email: u.email, password: u.password },
    {},
    { group: 'signin' },
  );
  checkOk(res, 'signin');
}
