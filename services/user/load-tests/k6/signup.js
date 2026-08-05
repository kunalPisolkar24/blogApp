import {
  postGraphQL,
  checkOk,
  signupVars,
  iterIndex,
  getDefaultOptions,
  queries,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 50;

export const options = getDefaultOptions({ vus, duration, rps });

export default function () {
  const res = postGraphQL(queries.SIGNUP_MUTATION, signupVars(iterIndex()), {}, { group: 'signup' });
  checkOk(res, 'signup');
}
