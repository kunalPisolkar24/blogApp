import {
    checkOk,
    client,
    ensureConnected,
    getDefaultOptions,
    parseWeights,
    pickWeighted,
    postDuration,
    postPayload,
    summaryDuration,
    summaryText,
    tagsDuration,
    tagsPayload,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 100;
const weights = parseWeights(__ENV.WEIGHTS || 'summary:40,tags:30,post:30');

export const options = getDefaultOptions({ vus, duration, rps });

export default function () {
    ensureConnected();
    const op = pickWeighted(weights, Math.random());

    let res;
    switch (op) {
        case 'tags': {
            const start = Date.now();
            res = client.invoke('ai.AIService/GenerateTags', tagsPayload(__ITER));
            tagsDuration.add(Date.now() - start);
            checkOk(res, 'tags');
            break;
        }
        case 'post': {
            const start = Date.now();
            res = client.invoke('ai.AIService/GeneratePost', postPayload(__ITER));
            postDuration.add(Date.now() - start);
            checkOk(res, 'post');
            break;
        }
        default: {
            const start = Date.now();
            res = client.invoke('ai.AIService/GenerateSummary', {
                text: summaryText(__ITER),
            });
            summaryDuration.add(Date.now() - start);
            checkOk(res, 'summary');
        }
    }
}
