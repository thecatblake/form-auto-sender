import express, { Request, Response } from "express";
import { createClient } from "redis";
import { discoverDuration, register, submissionCounter } from "./metrics";
import { discover_request } from "./discover_api";
import profileRouter from "./ profile/route";
import submissionRouter from "./submission/route";

interface SubmitPayload {
	url: string;
	profile: Record<string, string>
}

const app = express();
const PORT = 3000;


const redis = createClient();
const QUEUE_KEY = process.env.QUEUE_KEY ?? "contact_submission";

async function discover_and_push(url: string, profile: Record<string, string>) {
	const discover_results = await discover_request(url);

	const payloads = discover_results
		.filter(result => result.score > 50)
		.map(result => JSON.stringify({url: result.url, profile}))
	const push_res = await redis.lPush(QUEUE_KEY, payloads);

	if (push_res == 0)
		return 0;
	return payloads.length;
}

redis.on('error', err => console.log('Redis Client Error', err));

redis
.connect()
.then(() => {
	app.use(express.json());

	app.use("/profile", profileRouter);
	app.use("/submission", submissionRouter);

	app.get("/health", (_req: Request, res: Response) => {
		res.status(200).json({ status: "ok" });
	});

	app.post("/submit", async (req: Request, res: Response) => {
		const { url, profile } = req.body as SubmitPayload;

		if (!url || !profile) {
			return res.status(400).json({ error: "url and profile are required"})
		}

		const endTimer = discoverDuration.startTimer();
		const push_res = await discover_and_push(url, profile);
		endTimer();

		if (push_res == 0) {
			res.status(500).json({
				message: "Push to queue failed."
			})
		}

		submissionCounter.inc(push_res);

		res.status(202).json({
			message: "Jon accepted",
			url,
			profile
		})
	});

	app.post("/submit-batch", async (req: Request, res: Response) => {
		const payloads = req.body as SubmitPayload[];

		for (const payload of payloads) {
			const endTimer = discoverDuration.startTimer();
			await discover_and_push(payload.url, payload.profile);
			endTimer();
		}

		res.status(202).json({
			message: "Jon accepted"
		})
	});

	app.get("/metrics", async (_req: Request, res: Response) => {
		try {
			res.set("Content-Type", register.contentType);
			const metrics = await register.metrics();
			res.end(metrics);
		} catch (err) {
			res.status(500).end();
		}
	});

	app.listen(PORT, "0.0.0.0", () => {
		console.log(`Server listening on http://localhost:${PORT}`);
	})
})


