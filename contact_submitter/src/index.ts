import { chromium, Page } from "playwright";
import { DiscoverReq, DiscoverRes, Profile } from "./api";
import { TargetProvider, ApiTargetProvider, FileTargetProvider } from "./target_provider";
import { repository } from "./repository";
import pLimit from "p-limit";
import { logger } from "./logger";
import { findFormCandidates } from "./form";
import { fillFields } from "./mapper2";
import { SubmitResult, waitForSuccess } from "./verifier";
import { SubmitPayload } from "./mapper";

const limit = pLimit(1);

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

(async function () {
    // --- Configuration ---
    const USE_API = true; // Set to false to use FILE_PATH
    const API_URL = "https://x.stream-data.co.jp/backend/export/unsent-targets/";

    // For File Mode (CSV/TXT)
    const FILE_PATH = "targets.txt";
    const FILE_PROFILE: Profile = {
        id: 0,
        name: "File Profile",
        data: {
            // Define the profile to use for all targets in the file
            name: "Test User",
            email: "test@example.com",
            // Add other fields as needed matching SubmitPayload
        }
    };
    // ---------------------

    let provider: TargetProvider;
    if (USE_API) {
        provider = new ApiTargetProvider(API_URL);
    } else {
        provider = new FileTargetProvider(FILE_PATH, FILE_PROFILE);
    }

    const targets = await provider.getTargets();
    logger.info(`Loaded ${targets.length} targets`);

    // Save profile to DB (optional, but good for tracking)
    if (!USE_API) {
        await repository.saveProfile(FILE_PROFILE.name, FILE_PROFILE.data);
    }

    const browser = await chromium.launch({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--mute-audio",
            '--disk-cache-size=1',
            '--media-cache-size=1',
            '--disable-cache',
            "--no-first-run",
            "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaSessionService,InterestCohort",
        ],
    });

    await Promise.all(
        targets.map(target =>
            limit(async () => {
                const url = "https://stream-data.co.jp";

                logger.info(`Target: ${url}`);

                const discover_req: DiscoverReq = {
                    root_url: url,
                    top_n: 5,
                };

                try {
                    const discover_res = await fetch("http://localhost:8080/discover", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(discover_req),
                    });

                    if (!discover_res.ok) {
                        logger.error(`Discover API failed for ${url}: ${discover_res.statusText}`);
                        return;
                    }

                    const discover_results: DiscoverRes = await discover_res.json();

                    for (const item of discover_results.results_top) {
                        logger.info(`found a candidate ${item.url} score: ${item.score}`)
                        if (item.score < 50) continue;
                        const page = await browser.newPage();
                        try {
                            await page.goto(item.url, {
                                waitUntil: "domcontentloaded",
                                timeout: 15000, // Reduced timeout
                            });

                            logger.info(target.profile.data)

                            const submitResult = await fillAndSend(page, target.profile.data);

                            await sleep(10000);
                            console.log(`${url}: ${submitResult}`)


                            // Log result to DB
                            await repository.logSubmission(url, item.url, submitResult, target.profile.name);

                            if (submitResult === "success") {
                                await page.close();
                                break;
                            }
                        } catch (e) {
                            logger.error(`Error processing ${item.url}: ${e}`);
                        } finally {
                            if (!page.isClosed()) await page.close();
                        }
                    }
                } catch (e) {
                    logger.error(`Failed to process target ${url}: ${e}`);
                }
            })
        )
    );

    await browser.close();
})();
