// services/queueService.ts
import { Redis } from '@upstash/redis';
import {
    UPSTASH_REDIS_URL,
    UPSTASH_REDIS_TOKEN,
    SUMMARIZATION_QUEUE_KEY,
} from '../config';
import { JobPayload } from '../worker';

const redis = new Redis({
  url: UPSTASH_REDIS_URL,
  token: UPSTASH_REDIS_TOKEN,
});

export async function popJobFromQueue(): Promise<JobPayload | null> {
    console.log(`[QUEUE_SERVICE] Attempting RPOP on key: ${SUMMARIZATION_QUEUE_KEY}`);
    let rawDataFromRedis: any = null;

    try {
        rawDataFromRedis = await redis.rpop(SUMMARIZATION_QUEUE_KEY);

        if (rawDataFromRedis === null) {
            console.log(`[QUEUE_SERVICE] Queue ${SUMMARIZATION_QUEUE_KEY} was empty or RPOP returned null.`);
            return null;
        }

        console.log(`[QUEUE_SERVICE] Raw data received from redis.rpop:`, rawDataFromRedis);
        const dataType = typeof rawDataFromRedis;
        console.log(`[QUEUE_SERVICE] Type of raw data received: ${dataType}`);

        let jobPayload: JobPayload;

        if (dataType === 'object') {
            console.log('[QUEUE_SERVICE] Data is already an object. Assuming auto-parsed by Redis client.');
            jobPayload = rawDataFromRedis as JobPayload;

            if (typeof jobPayload.postId !== 'number' || typeof jobPayload.text !== 'string' || typeof jobPayload.attempt !== 'number') {
                console.error('[QUEUE_SERVICE] Auto-parsed object is missing required JobPayload fields:', jobPayload);
                return null;
            }
        } else if (dataType === 'string') {
            console.log(`[QUEUE_SERVICE] Data is a string. Attempting JSON.parse: "${rawDataFromRedis}"`);

            if (rawDataFromRedis === "[object Object]") {
                console.error(`[QUEUE_SERVICE] CRITICAL: redis.rpop returned the literal string "[object Object]".
                               This means a malformed string was stored in Redis. Job discarded.`);
                return null;
            }
            jobPayload = JSON.parse(rawDataFromRedis) as JobPayload;
        } else {
            console.error(`[QUEUE_SERVICE] UNEXPECTED data type received from redis.rpop: ${dataType}. Job discarded. Data:`, rawDataFromRedis);
            return null;
        }

        console.log(`[QUEUE_SERVICE] Successfully processed/parsed job payload for postId: ${jobPayload.postId}`);
        return jobPayload;

    } catch (error: any) {
        console.error(`[QUEUE_SERVICE] Error during popJobFromQueue for key ${SUMMARIZATION_QUEUE_KEY}: ${error.message}`);
        if (rawDataFromRedis !== null) {
            console.error(`[QUEUE_SERVICE] Data that caused error (if available):`, rawDataFromRedis);
            console.error(`[QUEUE_SERVICE] Type of data that caused error: ${typeof rawDataFromRedis}`);
        }
        return null;
    }
}

export async function requeueJob(jobData: JobPayload): Promise<void> {
    console.log(`[QUEUE_SERVICE] Re-queueing job for postId: ${jobData.postId}, attempt: ${jobData.attempt}.`);
    try {
        const stringifiedJobData = JSON.stringify(jobData);
        await redis.lpush(SUMMARIZATION_QUEUE_KEY, stringifiedJobData);
        console.log(`[QUEUE_SERVICE] Job for postId ${jobData.postId} re-queued successfully.`);
    } catch (error: any) {
        console.error(`[QUEUE_SERVICE] Error during LPUSH (requeue) operation for key ${SUMMARIZATION_QUEUE_KEY}: ${error.message}`, error);
    }
}