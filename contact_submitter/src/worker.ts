import fs from "fs";
import path from "path";
import { BrowserContext, chromium, Page } from "playwright";
import { createClient } from "redis";
import { findFormCandidates } from "./form";
import { logger } from "./logger";
import { fillFields, SubmitPayload } from "./mapper2";
import { SubmitResult, waitForSuccess } from "./verifier";
import { submissionProcessDuration } from "./metrics";

interface Submission {
	url: string,
	profile: SubmitPayload
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

	for (const form_candidate of form_candidates) {
		logger.info("mapping a form");

		await fillFields(form_candidate.root, payload);

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
	}

	return result;
}

async function consumeQueue(context: BrowserContext) {
	const raw_submission = await client.rPop(QUEUE_KEY);

	if (!raw_submission) {
		return ;
	}

	try {
		const submission = JSON.parse(raw_submission) as Submission;
		const page = await context.newPage();

		const endTimer = submissionProcessDuration.startTimer();
		const result = fillAndSend(page, submission.profile);
		endTimer();
	} catch {
		return ;
	}
}


client.on("error", err => console.log("Redis Client Error", err));

client.connect()
.then(async () => {
	clearPlaywrightCache();

	const browser = await chromium.launch({
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

			// ===== キャッシュ完全無効化 =====
			'--disk-cache-size=0',
			'--media-cache-size=0',
			'--disable-cache',
			'--disable-application-cache',
			'--disable-offline-load-stale-cache',
			'--disable-gpu-shader-disk-cache',

			// ===== 不要な機能無効化 =====
			"--no-first-run",
			"--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaSessionService,InterestCohort",
			"--disable-sync",
			"--disable-default-apps",
		],
	});

	// ===== キャッシュ無効化コンテキスト =====
	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		bypassCSP: true,
		userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		viewport: { width: 1280, height: 720 },

		// キャッシュ無効化
		storageState: undefined,
		acceptDownloads: false,
		recordVideo: undefined,
		recordHar: undefined,
		serviceWorkers: "block",
	});

	while (true) {
		consumeQueue(context);
	}	
});
