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

async function submitResult(result: FormResult) {
  const payload: StreamxSubmission = {
    target_id: Number(result.streamx_profile_id),
    payload: result.profile,
    status: result.result === "success" ? "success" : "failed",
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
    console.log("StreamX submission failed", res.status, await res.text());
  } else {
    console.log(`Reported ${result.streamx_profile_id} ${result.result}`);
  }

  return res;
}

async function consumeOne() {
  const raw = await client.lPop(RESULT_KEY);
  if (!raw) return false;

  const result = JSON.parse(raw) as FormResult;
  await submitResult(result);
  return true;
}

async function main() {
  await client.connect();
  console.log("Reporter started.");

  while (true) {
    try {
      const hasJob = await consumeOne();
      if (!hasJob) break;
    } catch (e) {
      console.error("Error while consuming:", e);
    }
  }

  console.log("Queue empty. Closing Redis...");
  await client.quit();
  console.log("Shutdown complete.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
