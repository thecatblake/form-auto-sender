import { chromium, Browser, Page } from "playwright";
import { DiscoverReq, DiscoverRes, Profile } from "./api";
import pLimit from "p-limit";
import { logger } from "./logger";
import { findFormCandidates } from "./form";
import { fillFields } from "./mapper2";
import { SubmitResult, waitForSuccess } from "./verifier";
import { SubmitPayload } from "./mapper";
import { repository } from "./repository";
import fs from "fs";
import path from "path";

const limit = pLimit(3);

// キャッシュクリーンアップ関数
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
                logger.info(`Cleaned up temp directory: ${dir}`);
            } catch (e) {
                logger.warn(`Failed to clean ${dir}: ${e}`);
            }
        });

        // User profile cache (optional - commented out to avoid deleting browser binaries)
        // const userProfile = process.env.USERPROFILE || process.env.HOME;
        // const msPlaywrightCache = path.join(userProfile, "AppData", "Local", "ms-playwright");
        // if (fs.existsSync(msPlaywrightCache)) {
        //     fs.rmSync(msPlaywrightCache, { recursive: true, force: true });
        // }

        logger.info("Playwright cache cleanup completed");
    } catch (e) {
        logger.warn(`Cache cleanup failed: ${e}`);
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

export async function runSubmissionJob(
    urls: string[],
    profile: Profile,
    jobStatus?: any,
    onUpdate?: (update: Partial<any>) => void
): Promise<void> {
    logger.info(`Starting submission job with ${urls.length} URLs using profile: ${profile.name}`);

    // ===== 送信済みURLをフィルタリング =====
    const unsubmittedUrls = await repository.filterUnsubmittedUrls(urls);
    const skippedCount = urls.length - unsubmittedUrls.length;

    if (skippedCount > 0) {
        logger.info(`Skipped ${skippedCount} already submitted URLs`);
        if (onUpdate) {
            onUpdate({
                logs: [...(jobStatus?.logs || []), `✓ ${skippedCount}件の送信済みURLをスキップしました`]
            });
        }
    }

    if (unsubmittedUrls.length === 0) {
        logger.info("All URLs have already been submitted. Nothing to do.");
        if (onUpdate) {
            onUpdate({
                logs: [...(jobStatus?.logs || []), `すべてのURLは送信済みです`]
            });
        }
        return;
    }

    logger.info(`Processing ${unsubmittedUrls.length} unsubmitted URLs`);
    if (onUpdate) {
        onUpdate({
            totalUrls: unsubmittedUrls.length,
            logs: [...(jobStatus?.logs || []), `${unsubmittedUrls.length}件の未送信URLを処理します`]
        });
    }

    // ===== キャッシュクリーンアップ =====
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

    // ===== リクエストインターセプションでキャッシュ完全無効化 =====
    await context.route("**/*", async route => {
        const resourceType = route.request().resourceType();

        // 画像・フォント・メディアをブロック（ディスク節約）
        if (['image', 'font', 'media', 'websocket'].includes(resourceType)) {
            return route.abort();
        }

        // キャッシュ無効化ヘッダーを追加
        await route.continue({
            headers: {
                ...route.request().headers(),
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        });
    });

    let processedCount = 0;

    await Promise.all(
        unsubmittedUrls.map(url =>
            limit(async () => {
                const rootUrl = url.startsWith("http") ? url : `https://${url}`;
                logger.info(`Target: ${rootUrl}`);

                if (onUpdate) {
                    onUpdate({
                        currentUrl: rootUrl,
                        logs: [...(jobStatus?.logs || []), `Processing: ${rootUrl}`]
                    });
                }

                const discover_req: DiscoverReq = {
                    root_url: rootUrl,
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
                        logger.error(`Discover API failed for ${rootUrl}: ${discover_res.statusText}`);
                        if (onUpdate) {
                            onUpdate({
                                logs: [...(jobStatus?.logs || []), `❌ Discover failed for ${rootUrl}`]
                            });
                        }
                        return;
                    }

                    const discover_results: DiscoverRes = await discover_res.json();

                    for (const item of discover_results.results_top) {
                        logger.info(`found a candidate ${item.url} score: ${item.score}`)
                        if (item.score < 50) continue;
                        const page = await context.newPage(); // ← context から作成
                        try {
                            await page.goto(item.url, {
                                waitUntil: "domcontentloaded",
                                timeout: 15000,
                            });

                            const submitResult = await fillAndSend(page, profile.data);

                            console.log(`${rootUrl}: ${submitResult}`)

                            // Log result to DB
                            await repository.logSubmission(rootUrl, item.url, submitResult, profile.name);

                            // Update job status
                            processedCount++;
                            if (onUpdate) {
                                const update: any = {
                                    processedUrls: processedCount,
                                    logs: [...(jobStatus?.logs || []), `${submitResult === 'success' ? '✅' : '❌'} ${rootUrl}: ${submitResult}`]
                                };

                                if (submitResult === 'success') {
                                    update.successCount = (jobStatus?.successCount || 0) + 1;
                                } else {
                                    update.failCount = (jobStatus?.failCount || 0) + 1;
                                }

                                onUpdate(update);
                            }

                            if (submitResult === "success") {
                                await page.close();
                                break;
                            }
                        } catch (e) {
                            logger.error(`Error processing ${item.url}: ${e}`);
                            if (onUpdate) {
                                onUpdate({
                                    logs: [...(jobStatus?.logs || []), `⚠️ Error: ${e}`]
                                });
                            }
                        } finally {
                            if (!page.isClosed()) await page.close();
                        }
                    }
                } catch (e) {
                    logger.error(`Failed to process target ${rootUrl}: ${e}`);
                    processedCount++;
                    if (onUpdate) {
                        onUpdate({
                            processedUrls: processedCount,
                            failCount: (jobStatus?.failCount || 0) + 1,
                            logs: [...(jobStatus?.logs || []), `❌ Failed: ${rootUrl} - ${e}`]
                        });
                    }
                }
            })
        )
    );

    // ===== クリーンアップ =====
    await context.close();
    await browser.close();

    // 最終キャッシュクリーンアップ
    clearPlaywrightCache();

    logger.info("Submission job completed");
}
