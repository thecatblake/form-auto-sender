import { Browser, BrowserContext } from "playwright";
import { acquireContext, releaseContext } from "./browserPool";
import { cfg } from "./config";
import { findFormCandidates } from "./detector";
import { discoverContacts } from "./discover";
import { click, fillFields, mapFields } from "./mapper";
import { neutralizeOverlays, screenshotOnFail } from "./utils";
import { waitForSuccess } from "./verifier";
import * as dotenv from 'dotenv'
import { exit } from "node:process";
dotenv.config()

const HOST = process.env.BACKEND_HOST;
const AUTH_KEY = process.env.FORM_SERVER_SECRET;

/** ページネーション共通型 */
export type Paginated<T> = {
    count: number;
    next: string | null;
    previous: string | null;
    results: T[];
};

/** Profile */
export type Profile = {
    id: number;
    name: string;
    data: Record<string, string>; // ← ここ
    version: number;
    updated_at: string;
};

/** UnsentTarget 1件分 */
export type UnsentTarget = {
    id: number;
    host: string;
    created_at: string;
    profile: Profile;
    tracking_id: string;
};

/** API レスポンス型 (UnsentTarget の Paginated) */
export type UnsentTargetsResponse = Paginated<UnsentTarget>;
async function getUnsentTargets() {
    console.info("[INFO] Fetching unsent targets...");
    const res = await fetch(
        get_host_url("export/unsent-targets/"),
        {
            method: "GET",
            headers: { "Authorization": `Bearer ${AUTH_KEY}` }
        }
    );
    const body = await res.json() as UnsentTargetsResponse;
    console.info(`[INFO] Received ${body.results.length} unsent targets`);
    return body;
}

async function sendSubmission(target: UnsentTarget, status: string, contact_url: string) {
    console.info(`[INFO] Reporting submission result: target=${target.id}, status=${status}`);
    const res = await fetch(
        get_host_url("export/submissions/"),
        {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${AUTH_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                status: status,
                form_url: contact_url,
                target_id: target.id,
                target: {
                    host: target.host,
                    contact_profile_id: target.profile.id,
                    tracking_id: target.tracking_id
                }
            })
        }
    );

    console.log(await res.text());
}

async function submitOne(url: string, payload: Record<string, string>, ctx: BrowserContext) {
    console.info(`[INFO] Trying submit for form: ${url}`);
    let page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.navTimeoutMs });

    const candidates = await Promise.race([
        findFormCandidates(page),
        page.waitForTimeout(cfg.findTimeoutMs).then(() => [] as Awaited<ReturnType<typeof findFormCandidates>>),
    ]);

    if (!candidates.length) {
        console.warn(`[WARN] No form candidates found on: ${url}`);
    }

    for (const cand of candidates.slice(0, 3)) {
        const root = cand.root;
        const map = await mapFields(root);
        if (!map.email || !map.message || !map.submit) {
            console.info("[INFO] Candidate skipped (required fields missing)");
            continue;
        }

        console.info("[INFO] Filling fields...");
        await fillFields(map, payload);

        await neutralizeOverlays(page);
        try { await map.submit!.click({ force: true }); } catch { }
        try { await page.keyboard.press("Enter"); } catch { }

        screenshotOnFail(page, url);

        const verdict = await waitForSuccess(page, { timeoutMs: 12_000, settleMs: 500 });
        console.info(`[INFO] Verdict after submit: ${verdict}`);

        if (verdict === "maybe") {
            return "success";
        }

        if (verdict !== "fail") {
            return "failed";
        }
    }

    return await waitForSuccess(page);
}


export function get_host_url(path: string): string {
    if (!path.startsWith("/")) {
        path = "/" + path;
    }
    return `${HOST}${path}`;
}

const SCORE_THRESHOLD = 30;

(async () => {
    const ctx = await acquireContext();
    try {
        const targets_res = await getUnsentTargets();
        const targets = targets_res.results;

        console.info(`[INFO] Start processing targets: count=${targets.length}`);

        for (const target of targets) {
            const startedAt = Date.now();
            const prefix = `[target=${target.id} host=${target.host}]`;
            const url = target.host;
            const payload = target.profile.data;

            console.info(`${prefix} Discovering contacts...`);
            let contacts: Array<{ url: string; score: number }> = [];

            try {
                contacts = await discoverContacts(
                    "http://localhost:8080/discover",
                    `https://${url}`,
                    100,
                    5,
                    10,
                    500,
                    30000
                );
                console.info(`${prefix} Discovered ${contacts.length} contact candidates`);
            } catch (err) {
                console.error(`${prefix} Contact discovery failed: ${String(err)}`);
                continue; // 次の target へ
            }

            let result: "success" | "fail" | "maybe" | null = null;

            for (const contactInfo of contacts) {
                console.info(`${prefix} Candidate: score=${contactInfo.score} url=${contactInfo.url}`);

                if (contactInfo.score <= SCORE_THRESHOLD) {
                    console.info(`${prefix} Skipped (score <= ${SCORE_THRESHOLD})`);
                    continue;
                }

                try {
                    const verdict = await submitOne(contactInfo.url, payload, ctx);
                    console.info(`${prefix} Submit verdict: ${verdict} url=${contactInfo.url}`);
                    result = verdict;

                    if (verdict === "success") {
                        sendSubmission(target, verdict, contactInfo.url);
                        console.info(`${prefix} Reported result to backend: status=success`);
                        break; // 成功したら他の候補は試さない
                    }
                } catch (err) {
                    console.warn(`${prefix} Submit attempt errored: ${String(err)}`);
                }
            }

            if (result && result !== "success") {
                sendSubmission(target, result, "");
                console.info(`${prefix} Reported result to backend: status=${result}`);
            } else if (!result) {
                console.info(`${prefix} No submission result (no eligible contacts or all failed)`);
            }

            console.info(`${prefix} Done in ${Date.now() - startedAt}ms`);
        }
    } catch (err) {
        console.error(`[ERROR] Fatal in main loop: ${String(err)}`);
    } finally {
        await releaseContext(ctx);
        await ctx.close()
        exit(0);
        console.info(`[INFO] Browser context released`);
    }
})();