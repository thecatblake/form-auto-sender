import { Browser, BrowserContext } from "playwright";
import { acquireContext, releaseContext } from "./browserPool";
import { cfg } from "./config";
import { findFormCandidates } from "./detector";
import { discoverContacts } from "./discover";
import { click, fillFields, mapFields } from "./mapper";
import { neutralizeOverlays, screenshotOnFail } from "./utils";
import { waitForSuccess } from "./verifier";
import * as dotenv from 'dotenv'
dotenv.config()


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

async function submitOne(url: string, payload: Record<string, string>, ctx: BrowserContext) {

	let page = await ctx.newPage();
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.navTimeoutMs });

	const candidates = await Promise.race([
		  findFormCandidates(page),
		  page.waitForTimeout(cfg.findTimeoutMs).then(() => [] as Awaited<ReturnType<typeof findFormCandidates>>),
		]);

	for (const cand of candidates) {
		const root = cand.root;
		const map = await mapFields(root);

		await fillFields(map, payload);

		await neutralizeOverlays(page);
		await click(map.submit);
		await page.keyboard.press("Enter");
	}

	await screenshotOnFail(page, url);

	return await waitForSuccess(page);
}

const HOST = process.env.BACKEND_HOST;
const AUTH_KEY = process.env.FORM_SERVER_SECRET;

export function get_host_url(path: string): string {
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return `${HOST}${path}`;
}

async function getUnsentTargets() {
    const res = await fetch(
        get_host_url("export/unsent-targets/"),
        {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${AUTH_KEY}`
            }
        }
    );
    console.log(res);
    const body = await res.json() as UnsentTargetsResponse;
    return body;
}

(async () => {
	let ctx = await acquireContext();
	const targets_res = await getUnsentTargets();
    const targets = targets_res.results;
	for (const target of targets) {
		const url = target.host;
        const payload = target.profile.data;

        const contacts = await discoverContacts(
            "http://localhost:8080/discover",
            url,
            100,
            5,
            10,
            500,
            30000
        );
        
        for (const contactInfo of contacts) {
            if (contactInfo.score > 50)
                console.log(await submitOne(contactInfo.url, payload, ctx));
        }
	}

	await releaseContext(ctx);
})();
