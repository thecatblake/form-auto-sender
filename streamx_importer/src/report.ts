import { createClient } from "redis";

const client = createClient();
const RESULT_KEY = process.env.RESULT_KEY ?? "contact_result";
const STREAMX_FORM_SECRET = "wDF5LOrkOIoU5THZMyZ7oQ9R7DNHUw4yANApPyA9dck";

interface FormResult {
  url: string;
  profile: Record<string, string>;
  host: string;
  result: string;
  streamx_profile_id: string;
}

interface StreamxSubmission {
  target_id: number;
  payload: Record<string, string>;
  status: "success" | "failed" | "pending";
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function submitResult(result: FormResult) {
  const payload: StreamxSubmission = {
    target_id: Number(result.streamx_profile_id),
    payload: result.profile,
    status: result.result === "success" ? "success" : "failed"
  };

  const res = await fetch("https://x.stream-data.co.jp/backend/export/submissions/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${STREAMX_FORM_SECRET}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("StreamX submission failed", res.status, await res.text());
  } else {
    console.log(`Reported ${result.streamx_profile_id} ${result.result}`);
  }

  return res;
}

async function consumeQueue() {
  const raw = await client.lPop(RESULT_KEY);
  if (!raw) return false;

  const result = JSON.parse(raw) as FormResult;
  await submitResult(result);
  return true;
}

// ----------------------------
// Graceful Shutdown Support
// ----------------------------
let shouldStop = false;

function setupGracefulShutdown() {
  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully shutting down...`);
    shouldStop = true;
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function mainLoop() {
  setupGracefulShutdown();

  await client.connect();
  console.log("Worker started.");

  while (true) {
    // shutdown 要求が来たら キューが空になったら終了
    if (shouldStop) {
      const hasJob = await consumeQueue();
      if (!hasJob) break;       // キューが空 → 終了へ
      continue;                 // まだキューにジョブ → ループ継続
    }

    try {
      const hasJob = await consumeQueue();
      if (!hasJob) await sleep(1000);
    } catch (e) {
      console.error(e);
    }
  }

  console.log("Queue drained. Closing Redis...");
  await client.quit();
  console.log("Shutdown complete.");
  process.exit(0);
}

mainLoop();
