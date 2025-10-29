import { BrowserContext } from "playwright";
import { acquireContext, releaseContext } from "./browserPool";
import { cfg } from "./config";
import { findFormCandidates } from "./detector";
import { discoverContacts } from "./discover";
import { fillFields, mapFields } from "./mapper";
import { neutralizeOverlays, screenshotOnFail } from "./utils";
import { waitForSuccess } from "./verifier";
import * as dotenv from "dotenv";
import { exit } from "node:process";
dotenv.config();

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
  data: Record<string, string>;
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
  const res = await fetch(get_host_url("export/unsent-targets/"), {
    method: "GET",
    headers: { Authorization: `Bearer ${AUTH_KEY}` },
  });
  const body = (await res.json()) as UnsentTargetsResponse;
  console.info(`[INFO] Received ${body.results.length} unsent targets`);
  return body;
}

/** status 正規化（maybe→success, fail→failed） */
function normalizeStatus(status: string): string {
  if (status === "maybe") return "success";
  if (status === "fail") return "failed";
  return status;
}

/** URL から host を取り出す（失敗時は空文字） */
function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

/** 指定の “左側キー” でサーバに送る */
async function sendSubmission(
  target: UnsentTarget,
  status: "success" | "fail" | "maybe",
  contact_url: string,
  payload: Record<string, string>
) {
  const body = {
    // ← ここがあなたの指定した「左側のキー」仕様
    target_id: target.id,
    profile: target.profile.id,
    target_host_snapshot: target.host || hostOf(contact_url), // どちらでもOKだが、まずはtarget.hostを優先
    form_url: contact_url,
    payload: payload ?? {},

    // 以下は空（または null）で送る指定
    status: normalizeStatus(status), // 空で良いなら "" にしてもOK（必要ならここを "" に変更）
    http_status: null,
    response_body: "",
    response_json: null,
    error_message: "",
  };

  console.info(
    `[INFO] Reporting submission result: target=${target.id}, status=${body.status}, form_url=${body.form_url}`
  );

  const res = await fetch(get_host_url("export/submissions/"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AUTH_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  console.log(await res.text());
}

async function submitOne(url: string, payload: Record<string, string>, ctx: BrowserContext) {
  console.info(`[INFO] Trying submit for form: ${url}`);
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: cfg.navTimeoutMs });

    const candidates = await Promise.race([
      findFormCandidates(page),
      page
        .waitForTimeout(cfg.findTimeoutMs)
        .then(() => [] as Awaited<ReturnType<typeof findFormCandidates>>),
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
      try {
        await map.submit!.click({ force: true });
      } catch {}
      try {
        await page.keyboard.press("Enter");
      } catch {}

      screenshotOnFail(page, url);

      const verdict = await waitForSuccess(page, { timeoutMs: 12_000, settleMs: 500 });
      console.info(`[INFO] Verdict after submit: ${verdict}`);

      if (verdict !== "fail") {
        return verdict as "success" | "maybe";
      }
    }

    return (await waitForSuccess(page)) as "success" | "maybe" | "fail";
  } finally {
    try {
      await page.close();
    } catch {}
  }
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
      const urlHost = target.host;
      const payload = target.profile.data;

      console.info(`${prefix} Discovering contacts...`);
      let contacts: Array<{ url: string; score: number }> = [];

      try {
        contacts = await discoverContacts(
          "http://localhost:8080/discover",
          `https://${urlHost}`,
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
      let lastTriedContactUrl: string | null = null;
      let reported = false; // 二重報告防止

      for (const contactInfo of contacts) {
        console.info(`${prefix} Candidate: score=${contactInfo.score} url=${contactInfo.url}`);

        if (contactInfo.score <= SCORE_THRESHOLD) {
          console.info(`${prefix} Skipped (score <= ${SCORE_THRESHOLD})`);
          continue;
        }

        lastTriedContactUrl = contactInfo.url;

        try {
          const verdict = await submitOne(contactInfo.url, payload, ctx);
          console.info(`${prefix} Submit verdict: ${verdict} url=${contactInfo.url}`);
          result = verdict;

          if (verdict === "success" || verdict === "maybe") {
            await sendSubmission(target, verdict, contactInfo.url, payload);
            reported = true;
            console.info(`${prefix} Reported result to backend: status=${verdict}`);
            break; // 成功/Maybe なら他の候補は試さない
          }
        } catch (err) {
          console.warn(`${prefix} Submit attempt errored: ${String(err)}`);
        }
      }

      // fail のときだけ最後の URL で送る
      if (!reported && result === "fail") {
        const contactUrlForReport = lastTriedContactUrl ?? `https://${urlHost}`;
        await sendSubmission(target, "fail", contactUrlForReport, payload);
        console.info(`${prefix} Reported result to backend: status=fail`);
      } else if (!result) {
        console.info(`${prefix} No submission result (no eligible contacts or all failed to detect)`);
      }

      console.info(`${prefix} Done in ${Date.now() - startedAt}ms`);
    }
  } catch (err) {
    console.error(`[ERROR] Fatal in main loop: ${String(err)}`);
  } finally {
    try {
      await releaseContext(ctx);
    } catch {}
    try {
      await ctx.close();
    } catch {}
    exit(0);
  }
})();
