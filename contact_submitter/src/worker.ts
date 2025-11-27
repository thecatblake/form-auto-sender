import fs from "fs";
import path from "path";
import { Browser, BrowserContext, chromium, Page } from "playwright";
import { createClient } from "redis";
import { findFormCandidates, FormCandidate } from "./form";
import { logger } from "./logger";
import { fillFields, SubmitPayload } from "./mapper2";
import { SubmitResult, waitForSuccess } from "./verifier";
import { startMetricsServer, submissionProcessDuration, submissionProcessed } from "./metrics";

interface Profile {
  id: string,
  name: string,
  body: string
}

interface Submission {
	host: string,
	url: string,
	profile: Profile,
	profile_id: string
}

const client = createClient();
const QUEUE_KEY = process.env.QUEUE_KEY ?? "contact_submission";

function clearPlaywrightCache() {
	try {
		// Windows temp directory
		const tempDir = process.env.TEMP || process.env.TMP || "C:\Users\strea\AppData\Local\Temp";
		const playwrightTempPattern = path.join(tempDir, "playwright*");

		// Glob pattern matching for playwright temp dirs
		const tempDirs = fs.readdirSync(tempDir).filter(name => name.startsWith("playwright"));
		tempDirs.forEach(dir => {
			try {
				fs.rmSync(path.join(tempDir, dir), { recursive: true, force: true });
			} catch (e) {
			}
		});

	} catch (e) {

	}
}

async function fillAndSend(page: Page, payload: SubmitPayload): Promise<SubmitResult> {
	let result: SubmitResult = "fail";
	const form_candidates = await findFormCandidates(page);
	const top_candidates = form_candidates.filter(form => form.score >= 50);

	if (top_candidates.length === 0)
		return "form_not_found";
	let form_candidate: FormCandidate = form_candidates[0];
	
	try {
		logger.info("filling a form");
		logger.info("payload")
		await fillFields(form_candidate.root, payload);
	} catch {
		return "fill_failed";
	}

	try {
		logger.info("submitting");
		const submitButtons = await form_candidate.root.locator(`
			input[type="submit"],
			input[type="button"],
			input[type="image"],
			button[type="submit"],
			button
		`).all();

		for (const submitButton of submitButtons) {
			await submitButton.click();

			const submitResult = await waitForSuccess(page);

			if (submitResult === "success")
				return "success";

			result = submitResult;
		}
	} catch {
		return "submit_failed";
	}

	return result;
}

async function reportSubmissionResult(submission: Submission, result: string) {
  try {
	logger.info(`processed url: ${submission.url} result: ${result}`)
    const res = await fetch(`http://localhost:3000/submission`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile_id: submission.profile_id,
        host: submission.host,
        contact_url: submission.url,
        result,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error(
        `Failed to report submission result: ${res.status} ${res.statusText} ${text}`
      );
    }
  } catch (e) {
    logger.error("Error reporting submission result", e);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function consumeQueue(context: BrowserContext) {
	const raw_submission = await client.rPop(QUEUE_KEY);

	const endTimer = submissionProcessDuration.startTimer();
	if (!raw_submission) {
		await sleep(1000);
		return ;
	}

	const submission = JSON.parse(raw_submission) as Submission;
	const page = await context.newPage();
	logger.info(`submission received: ${submission.url} for ${submission.profile_id}`)
	try {
		await page.goto(
			submission.url, {
				waitUntil: "domcontentloaded",
				timeout: 15000,
			});
	} catch {
		reportSubmissionResult(submission, "goto_timeout");
	}

	try {
		const profile = JSON.parse(submission.profile.body);
		const result = await fillAndSend(page, profile);
		

		reportSubmissionResult(submission, result);
	} catch {
		reportSubmissionResult(submission, "fill failed");
	} finally {
		await page.close();
		submissionProcessed.inc();
		endTimer();
	}
}


client.on("error", err => console.log("Redis Client Error", err));

const WORKER_COUNT = Number(process.env.WORKERS ?? 1);

let shuttingDown = false;
let browser: Browser | null = null;
let contexts: BrowserContext[] = [];

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  shuttingDown = true;

  try {
    // queue 側の処理を止めたいなら
    await client.quit().catch(() => {});

    // workers のループが 1 周回り終わるのを待つイメージ
    await Promise.all(
      contexts.map(async (ctx) => {
        try { await ctx.close(); } catch {}
      })
    );

    if (browser) {
      try { await browser.close(); } catch {}
    }
  } catch (e) {
    logger.error("Error during shutdown", e);
  } finally {
    process.exit(0);
  }
});


client.connect()
.then(async () => {
    startMetricsServer(9200);

    clearPlaywrightCache();

    browser = await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--mute-audio",
            '--disk-cache-size=0',
            '--media-cache-size=0',
            '--disable-cache',
            '--disable-application-cache',
            '--disable-offline-load-stale-cache',
            '--disable-gpu-shader-disk-cache',
            "--no-first-run",
            "--disable-features=Translate,BackForwardCache",
            "--disable-sync",
        ],
    });

    for (let i = 0; i < WORKER_COUNT; i++) {
        const ctx = await browser.newContext({
            ignoreHTTPSErrors: true,
            bypassCSP: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            viewport: { width: 1280, height: 720 },
            storageState: undefined,
            acceptDownloads: false,
            serviceWorkers: "block",
        });
        contexts.push(ctx);
    }

    logger.info(`Starting ${WORKER_COUNT} workers`);
    await Promise.all(
        contexts.map((ctx, idx) => workerLoop(ctx, idx))
    );
});


async function workerLoop(context: BrowserContext, workerId: number) {
  logger.info(`worker ${workerId} started`);
  while (!shuttingDown) {
    try {
      await consumeQueue(context);
    } catch (e) {
      logger.error(`Worker ${workerId} error`, e);
    }
  }
  logger.info(`worker ${workerId} stopped`);
}