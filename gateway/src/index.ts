import express, { Request, Response } from "express";
import { createClient } from "redis";
import { register, submissionCounter } from "./metrics";

interface SubmitPayload {
	url: string;
	profile: Record<string, string>
}

const app = express();
const PORT = process.env.PORT ?? 3000;


const redis = createClient();
const QUEUE_KEY = process.env.QUEUE_KEY ?? "contact_submission";

redis.on('error', err => console.log('Redis Client Error', err));

redis
.connect()
.then(() => {
	app.use(express.json());

	app.get("/health", (_req: Request, res: Response) => {
		res.status(200).json({ status: "ok" });
	});

	app.post("/submit", async (req: Request, res: Response) => {
		const { url, profile } = req.body as SubmitPayload;

		if (!url || !profile) {
			return res.status(400).json({ error: "url and profile are required"})
		}

		const push_res = await redis.lPush(QUEUE_KEY, JSON.stringify({ url, profile }));

		if (push_res == 0) {
			res.status(500).json({
				message: "Push to queue failed."
			})
		}

		submissionCounter.inc()

		res.status(202).json({
			message: "Jon accepted",
			url,
			profile
		})
	});

	app.post("/submit-batch", (req: Request, res: Response) => {
		const payloads = req.body as SubmitPayload[];

		redis.lPush(QUEUE_KEY, JSON.stringify(payloads));

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

	app.listen(PORT, () => {
		console.log(`Server listening on http://localhost:${PORT}`);
	})
})


