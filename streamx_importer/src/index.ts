import { createClient } from "redis";
import { discover_request } from "./discover_api";

const redis = createClient();
const QUEUE_KEY = process.env.QUEUE_KEY ?? "contact_submission";


interface Pagination<T> {
	count: number;
	next?: string;
	previous?: string;
	results: T[]
}

interface SubmitProfile {
	id: number;
	name: string;
	data: Record<string, string>;
	version: number;
	updated_at: string;
}

interface StreamXTarget {
	id: number;
	host: string;
	created_at: string;
	profile: SubmitProfile
}

type StreamxRes = Pagination<StreamXTarget>;

async function* iterate_over_streamx() {
	let page: StreamxRes | null;
	let page_num = 1;
	let next_url: string | null = `https://x.stream-data.co.jp/backend/export/unsent-targets/?page=${page_num}`;
	do {
		const res = await fetch(next_url);
		page = await res.json() as StreamxRes;
		for (const result of page.results) {
			yield result;
		}
		page_num += 1;
		next_url = page.next ? `https://x.stream-data.co.jp/backend/export/unsent-targets/?page=${page_num}` : null;
	} while (next_url);
}

async function submit_job(url: string, profile: SubmitProfile) {
	const discover_results = await discover_request(url);
	const urlObj = new URL(url);

	if (profile == null)
		return -1;

	const payloads = discover_results
		.filter(result => result.score > 50)
		.map(result => JSON.stringify({url: result.url, profile, host: urlObj.host, save_result: true}));

	if (payloads.length == 0) {
		return 0;
	}

	const push_res = await redis.lPush(QUEUE_KEY, payloads[0]);

	console.log(`submitted ${url}`)

	if (push_res == 0)
		return 0;
	return payloads.length;
}

redis
.connect()
.then(async () => {
	for await (const result of iterate_over_streamx()) {
		const data = result.profile.data;

		if (data.email === "k222ryousuke@gmail.com") {
			submit_job(`https://${result.host}`, result.profile);
		}
	}
});