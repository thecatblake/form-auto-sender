import express, { Request, Response } from "express";
import { createClient } from "redis";

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

	app.post("/submit", (req: Request, res: Response) => {
		const { url, profile } = req.body as SubmitPayload;

		if (!url || !profile) {
			return res.status(400).json({ error: "url and profile are required"})
		}

		redis.lPush(QUEUE_KEY, JSON.stringify({ url, profile }));

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

	app.listen(PORT, () => {
		console.log(`Server listening on http://localhost:${PORT}`);
	})
})


