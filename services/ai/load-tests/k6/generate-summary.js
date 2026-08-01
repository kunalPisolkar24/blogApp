import {
    checkOk,
    client,
    ensureConnected,
    getDefaultOptions,
    summaryDuration,
    summaryText,
} from './shared.js';

const vus = parseInt(__ENV.VUS) || 20;
const duration = __ENV.DURATION || '30s';
const rps = parseInt(__ENV.RPS) || 100;

export const options = getDefaultOptions({ vus, duration, rps });

export default function () {
    ensureConnected();
    const start = Date.now();
    const res = client.invoke('ai.AIService/GenerateSummary', {
        text: summaryText(__ITER),
    });
    summaryDuration.add(Date.now() - start);
    checkOk(res, 'summary');
}
