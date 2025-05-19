import {
  MAX_JOB_ATTEMPTS,
  MAX_ML_WAIT_TIME_MS,
  HEALTH_CHECK_INTERVAL_MS,
  MAX_EMPTY_POLLS_BEFORE_IDLE,
  EMPTY_QUEUE_POLL_INTERVAL_MS,
} from "./config";
import {
  pingLightningAIHealth,
  callSummarizeService,
} from "./services/mlService";
import {
  updatePostSuccess,
  updatePostStatusToPending,
} from "./services/dbService";
import { popJobFromQueue, requeueJob } from "./services/queueService";

export interface JobPayload {
  postId: number;
  text: string;
  attempt: number;
}

let isConsumerLoopActive = false;
let isMLServiceCurrentlyReady = false;
let activeJobProcessingCount = 0;

async function waitForMLServiceReady(timeoutMs: number): Promise<boolean> {
  console.log(`Waiting for ML service (max ${timeoutMs / 1000}s)...`);
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await pingLightningAIHealth()) {
      console.log("ML service is ready.");
      return true;
    }
    console.log(
      `ML service not ready, waiting ${
        HEALTH_CHECK_INTERVAL_MS / 1000
      }s before next check...`
    );
    await new Promise((resolve) =>
      setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS)
    );
  }
  console.error(
    `ML service did not become ready within ${timeoutMs / 1000}s timeout.`
  );
  return false;
}

async function handleJobProcessing(jobData: JobPayload): Promise<void> {
  activeJobProcessingCount++;
  const { postId, text, attempt } = jobData;
  console.log(
    `Processing job for postId: ${postId}, attempt: ${attempt}. Active jobs: ${activeJobProcessingCount}`
  );

  try {
    if (!isMLServiceCurrentlyReady) {
      console.log(
        `ML service marked not ready before processing postId ${postId}. Re-checking...`
      );
      isMLServiceCurrentlyReady = await waitForMLServiceReady(
        MAX_ML_WAIT_TIME_MS
      );
    }

    if (!isMLServiceCurrentlyReady) {
      console.warn(
        `ML service not ready for postId ${postId} after re-check. Re-queueing.`
      );
      if (attempt < MAX_JOB_ATTEMPTS) {
        await requeueJob({ ...jobData, attempt: attempt + 1 });
        await updatePostStatusToPending(postId);
      } else {
        console.error(
          `Max attempts reached for postId ${postId} due to ML service unavailability. DB status remains PENDING.`
        );
        await updatePostStatusToPending(postId);
      }
      return;
    }

    const summary = await callSummarizeService(text);

    if (summary) {
      await updatePostSuccess(postId, summary);
    } else {
      console.warn(
        `Summarization failed for postId ${postId} on attempt ${attempt}.`
      );
      isMLServiceCurrentlyReady = false;
      console.log(
        "Marked ML service as not ready due to summarization failure."
      );

      if (attempt < MAX_JOB_ATTEMPTS) {
        await requeueJob({ ...jobData, attempt: attempt + 1 });
        await updatePostStatusToPending(postId);
      } else {
        console.error(
          `Max summarization attempts reached for postId ${postId}. Job discarded. DB status remains PENDING.`
        );
        await updatePostStatusToPending(postId);
      }
    }
  } catch (error) {
    console.error(
      `Error during handleJobProcessing for postId ${postId}:`,
      error
    );
  } finally {
    activeJobProcessingCount--;
    console.log(
      `Finished processing for postId: ${postId}. Active jobs: ${activeJobProcessingCount}`
    );
  }
}

export async function startConsumerLoop(): Promise<void> {
  if (isConsumerLoopActive) {
    console.log("Consumer loop requested but already running.");
    return;
  }
  isConsumerLoopActive = true;
  activeJobProcessingCount = 0;
  console.log("Consumer loop starting...");

  isMLServiceCurrentlyReady = await waitForMLServiceReady(MAX_ML_WAIT_TIME_MS);
  if (!isMLServiceCurrentlyReady) {
    console.error(
      "ML Service failed initial readiness check. Loop will start, but jobs may be requeued until service is available or worker goes idle."
    );
  } else {
    console.log("ML Service initially ready. Waiting for jobs from queue...");
  }

  let consecutiveEmptyPolls = 0;

  while (isConsumerLoopActive) {
    try {
      let jobData: JobPayload | null = null;
      if (isMLServiceCurrentlyReady) {
        jobData = await popJobFromQueue();
      } else {
        console.log("ML Service not currently ready, skipping queue poll.");
      }

      if (jobData) {
        consecutiveEmptyPolls = 0;
        console.log("Job received from queue.");
        handleJobProcessing(jobData).catch((err) => {
          console.error("Unhandled error from async handleJobProcessing:", err);
        });
      } else {
        consecutiveEmptyPolls++;
        if (isMLServiceCurrentlyReady) {
          console.log(
            `Queue empty or invalid job. Poll count: ${consecutiveEmptyPolls}.`
          );
        } else {
          console.log(
            `ML Service not ready. Empty poll equivalent. Poll count: ${consecutiveEmptyPolls}.`
          );
        }

        if (consecutiveEmptyPolls >= MAX_EMPTY_POLLS_BEFORE_IDLE) {
          console.log(`Consumer idle for ${consecutiveEmptyPolls} polls.`);
          if (activeJobProcessingCount > 0) {
            console.log(
              `Still ${activeJobProcessingCount} jobs being processed. Will not go fully idle yet. Checking ML health.`
            );
            isMLServiceCurrentlyReady = await pingLightningAIHealth();
            await new Promise((resolve) =>
              setTimeout(resolve, EMPTY_QUEUE_POLL_INTERVAL_MS)
            );
            continue;
          }

          console.log(
            "Max empty polls reached and no active jobs. Consumer going idle."
          );
          isMLServiceCurrentlyReady = false;
          isConsumerLoopActive = false;
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, EMPTY_QUEUE_POLL_INTERVAL_MS)
        );
      }
    } catch (e: any) {
      console.error(
        "CRITICAL error in consumer loop's main structure:",
        e.message,
        e.stack
      );
      isMLServiceCurrentlyReady = false;
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS * 2)
      );
    }
  }

  if (!isConsumerLoopActive) {
    console.log("Consumer loop has stopped and is now idle.");
  } else {
    console.log("Consumer loop has stopped for other reasons.");
  }
  isConsumerLoopActive = false;
}

export function stopConsumerLoop(): void {
  if (!isConsumerLoopActive && activeJobProcessingCount === 0) {
    console.log("Consumer loop already stopped and no active jobs.");
    return;
  }
  console.log("Requesting consumer loop to stop...");
  isConsumerLoopActive = false;
}

export function getConsumerStatus(): {
  loopActive: boolean;
  mlServiceReady: boolean;
  activeJobs: number;
} {
  return {
    loopActive: isConsumerLoopActive,
    mlServiceReady: isMLServiceCurrentlyReady,
    activeJobs: activeJobProcessingCount,
  };
}

export function setMLServiceStatus(isReady: boolean): void {
  if (isMLServiceCurrentlyReady !== isReady) {
    console.log(
      `External call to setMLServiceStatus: changing from ${isMLServiceCurrentlyReady} to ${isReady}`
    );
  } else {
    console.log(
      `External call to setMLServiceStatus: status remains ${isReady}`
    );
  }
  isMLServiceCurrentlyReady = isReady;
}
