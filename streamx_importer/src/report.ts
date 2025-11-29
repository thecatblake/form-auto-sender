import { Result } from "pg";
import { createClient } from "redis";

const client = createClient();
const RESULT_KEY = process.env.RESULT_KEY ?? "contact_result";
const STREAMX_FORM_SECRET = "wDF5LOrkOIoU5THZMyZ7oQ9R7DNHUw4yANApPyA9dck"


interface FormResult {
	url: string,
	profile: Record<string, string>,
	host: string,
	result: string,
	streamx_profile_id: string
}

interface StreamxSubmission {
	target: number,
	payload: Record<string, string>,
	status: "success" | "failed" | "pending"
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function submitResult(result: FormResult) {
	const payload: StreamxSubmission = {
		target: Number(result.streamx_profile_id),
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
		console.log("StreamX submission OK");
	}

	return res;
}

async function consumeQueue() {
	const raw_submission = await client.lPop(RESULT_KEY);

	if (!raw_submission) 
		return await sleep(1000);

	const result = JSON.parse(raw_submission) as FormResult;
	await submitResult(result);
}

client
.connect()
.then(async () => {
	try {
      await consumeQueue();
    } catch (e) {
		console.log(e);
    }
});
