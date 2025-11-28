import express, { Request, Response } from "express";
import { createClient } from "redis";
import { discoverDuration, register, submissionCounter } from "./metrics";
import { discover_request } from "./discover_api";
import profileRouter from "./ profile/route";
import submissionRouter from "./submission/route";
import { getSubmitProfile } from "./ profile/api";
import { pool, query } from "./db";
import { to as copyTo } from "pg-copy-streams";

interface SubmitPayload {
	url: string;
	profile_id: string
}

const app = express();
const PORT = 3000;


const redis = createClient();
const QUEUE_KEY = process.env.QUEUE_KEY ?? "contact_submission";

async function discover_and_push(url: string, profile_id: string) {
	const discover_results = await discover_request(url);

	const profile = await getSubmitProfile(profile_id);

	const urlObj = new URL(url);

	if (profile == null)
		return -1;

	const payloads = discover_results
		.filter(result => result.score > 50)
		.map(result => JSON.stringify({url: result.url, profile, profile_id, host: urlObj.host}));

	if (payloads.length == 0)
		return 0;

	const push_res = await redis.lPush(QUEUE_KEY, payloads[0]);

	if (push_res == 0)
		return 0;
	return payloads.length;
}

async function get_if_submission_exists(url: string, profile_id: string): Promise<boolean> {
  const urlObj = new URL(url);

  const sql = `
    SELECT 1
    FROM submission_result
    WHERE host = $1 AND profile_id = $2
    LIMIT 1
  `;

  const rows = await query<{ exists: number }>(sql, [urlObj.host, profile_id]);
  return rows.length > 0;
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

	app.get("/result.csv", async (req: Request, res: Response) => {
		const client = await pool.connect();
		res.setHeader("Content-Type", "text/csv; charset=utf-8");
		res.setHeader(
			"Content-Disposition",
			'attachment; filename="data.csv"'
		);

		const sql = `
		COPY (
			SELECT * 
			FROM submission_result
		) TO STDOUT WITH CSV HEADER
		`

		try {
			const pgStream = client.query(copyTo(sql));

			pgStream.on("error", (err) => {
				console.error("pgStream error", err);
				if (!res.headersSent) {
					res.status(500).end("internal error");
				} else {
					res.destroy(err);
				}
				client.release();
			});

			pgStream.on("end", () => {
				client.release();
			});

			pgStream.pipe(res);
		} catch (err) {
			console.error(err);
			client.release();
			res.status(500).end("internal error");
		}
	})

	app.post("/submit", async (req: Request, res: Response) => {
		const { url, profile_id } = req.body as SubmitPayload;

		if (!url || !profile_id) {
			return res.status(400).json({ error: "url and profile are required"})
		}

		if (await get_if_submission_exists(url, profile_id))  {
			return res.status(409).json({
				message: "submission exists"
			})
		}

		const endTimer = discoverDuration.startTimer();
		const push_res = await discover_and_push(url, profile_id);
		endTimer();

		if (push_res == 0) {
			return res.status(500).json({
				message: "Push to queue failed."
			})
		} else if (push_res == -1)
			return res.status(400).json({
				message: "Profile not found"
			})

		submissionCounter.inc(push_res);

		res.status(202).json({
			message: "Jon accepted",
			url,
			profile_id
		})
	});

	app.post("/submit-batch", async (req: Request, res: Response) => {
		const payloads = req.body as SubmitPayload[];

		for (const payload of payloads) {
			const endTimer = discoverDuration.startTimer();
			await discover_and_push(payload.url, payload.profile_id);
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


