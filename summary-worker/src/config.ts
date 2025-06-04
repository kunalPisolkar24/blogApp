import dotenv from "dotenv";

dotenv.config();

export const PORT: number = parseInt(process.env.PORT || "8000", 10);
export const WAKEUP_SECRET = process.env.RAILWAY_WAKEUP_SECRET;
export const SUMMARIZATION_QUEUE_KEY = "summarization_jobs_v1";
export const MAX_JOB_ATTEMPTS = 3;
export const EMPTY_QUEUE_POLL_INTERVAL_MS = 5 * 1000;
export const MAX_EMPTY_POLLS_BEFORE_IDLE = 6;

export const DATABASE_URL = process.env.DATABASE_URL!;
export const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
export const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
export const LIGHTNING_AI_URL = process.env.LIGHTNING_AI_URL!;
export const LIGHTNING_AI_AUTH_TOKEN = process.env.LIGHTNING_AI_AUTH_TOKEN;

export const HEALTH_CHECK_TIMEOUT_MS = 5 * 1000;
export const HEALTH_CHECK_INTERVAL_MS = 10 * 1000;
export const MAX_ML_WAIT_TIME_MS = 150 * 1000;
export const SUMMARIZE_TIMEOUT_MS = 4 * 60 * 1000;

if (
  !DATABASE_URL ||
  !UPSTASH_REDIS_URL ||
  !UPSTASH_REDIS_TOKEN ||
  !LIGHTNING_AI_URL ||
  !LIGHTNING_AI_AUTH_TOKEN
) {
  console.error(
    "CRITICAL: Missing one or more required environment variables (DB, Redis, ML URL, ML Auth Token)."
  );
  process.exit(1);
}