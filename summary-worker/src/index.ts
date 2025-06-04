import express, { Express, Request, Response, NextFunction } from "express";
import { PORT, WAKEUP_SECRET } from "./config";
import {
  startConsumerLoop,
  getConsumerStatus,
  setMLServiceStatus,
} from "./worker";
import { pingLightningAIHealth } from "./services/mlService";

const app: Express = express();
app.use(express.json());

app.get("/health", (req: Request, res: Response) => {
  console.log("GET - request on /health");
  const timestamp = new Date().toISOString();
  const workerStatus = getConsumerStatus();
  res.status(200).json({
    status: "OK",
    message: "Consumer service is running.",
    consumerLoopActive: workerStatus.loopActive,
    mlServiceReady: workerStatus.mlServiceReady,
    timestamp: timestamp,
  });
});

app.post("/wakeup", (req: Request, res: Response): void => {
  console.log("POST - request on /wakeup");
  if (WAKEUP_SECRET && req.headers["x-wakeup-secret"] !== WAKEUP_SECRET) {
    console.warn("Received /wakeup call with invalid/missing secret.");
    res.status(403).send("Forbidden");
    return;
  }
  console.log("Received /wakeup call.");
  res.status(200).send("OK - Wakeup signal received.");

  const workerStatus = getConsumerStatus();
  if (!workerStatus.loopActive) {
    console.log("Wakeup call initiating consumer loop.");
    startConsumerLoop();
  } else {
    console.log(
      "Wakeup call received, consumer loop already active. Triggering ML health check."
    );
    pingLightningAIHealth()
      .then((isReady) => setMLServiceStatus(isReady))
      .catch((err) => {
        console.error("Error during ML health check triggered by wakeup:", err);
        setMLServiceStatus(false);
      });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
