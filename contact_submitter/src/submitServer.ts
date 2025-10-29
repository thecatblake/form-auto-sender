// src/submitServer.ts
import express from "express";
import morgan from "morgan";
import http from "http";
import pLimit from "p-limit";
import { z } from "zod";
import { Page } from "playwright";

import {
  acquireContext,
  releaseContext,
  initBrowserIfNeeded,
  shutdown as shutdownBrowser,
} from "./browserPool.js";
import { findFormCandidates } from "./detector.js";
import { mapFields, fillFields } from "./mapper.js";
import { waitForSuccess } from "./verifier.js";
import { neutralizeOverlays as neutralizeOverlaysFromUtils, screenshotOnFail } from "./utils.js";

/* ================== 基本設定 ================== */
const PORT = Number(process.env.PORT ?? 7070);
const GLOBAL_PARALLEL = Number(process.env.GLOBAL_PARALLEL ?? 4);   // サーバ全体の同時実行
const PER_DOMAIN_PARALLEL = Number(process.env.PER_DOMAIN_PARALLEL ?? 1); // 同一ドメイン内の同時実行
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 20_000);
const FIND_TIMEOUT_MS = Number(process.env.FIND_TIMEOUT_MS ?? 6_000);

// 待機を許可するため、タイムアウトを長めに（必要に応じて調整）
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 10 * 60_000);

/* ================== サーバ初期化 ================== */
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// Node HTTP サーバ（Keep-Alive / Request Timeout 調整）
const server = http.createServer(app);
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;
server.requestTimeout = REQUEST_TIMEOUT_MS;

/* ================== 並列制御（待機キュー） ================== */
const globalLimit = pLimit(GLOBAL_PARALLEL);

// domainLocks は LRU+TTL で掃除（無限増殖防止）
const domainLocks = new Map<string, { limiter: ReturnType<typeof pLimit>; ts: number }>();
const DOMAIN_LOCK_MAX = Number(process.env.DOMAIN_LOCK_MAX ?? 1000);
const DOMAIN_LOCK_TTL_MS = Number(process.env.DOMAIN_LOCK_TTL_MS ?? 10 * 60_000);

function domainOf(url: string) {
  try { return new URL(url).hostname; } catch { return ""; }
}
function domainLock(host: string) {
  const now = Date.now();
  let ent = domainLocks.get(host);
  if (!ent) {
    ent = { limiter: pLimit(PER_DOMAIN_PARALLEL), ts: now };
    domainLocks.set(host, ent);
  }
  ent.ts = now;
  if (domainLocks.size > DOMAIN_LOCK_MAX) sweepDomainLocks();
  return ent.limiter;
}
function sweepDomainLocks() {
  const now = Date.now();
  for (const [k, v] of domainLocks) {
    if (now - v.ts > DOMAIN_LOCK_TTL_MS) domainLocks.delete(k);
  }
}
setInterval(sweepDomainLocks, 60_000).unref();

/* ================== スキーマ ================== */
const SubmitReq = z.object({
  url: z.string().url(),
  payload: z.record(z.any()),
});
type SubmitReq = z.infer<typeof SubmitReq>;

/* ================== ログ & ユーティリティ ================== */
function log(...args: any[]) {
  console.info(new Date().toISOString(), "[submit]", ...args);
}

async function screenshotBase64(page: Page): Promise<string | undefined> {
  try {
    const b = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false });
    return `data:image/jpeg;base64,${b.toString("base64")}`;
  } catch { return undefined; }
}

/* ================== オーバーレイ無効化 ================== */
async function neutralizeOverlays(page: Page) {
  try { await neutralizeOverlaysFromUtils(page); } catch {}

  await page.addStyleTag({
    content: `
      .mailpoet_form_popup_overlay,
      .mailpoet_form_popup,
      .mpopup-overlay,
      .popup-overlay,
      .modal-backdrop,
      .remodal-overlay,
      .remodal-wrapper,
      .pum-overlay,
      .pum-container,
      .mfp-bg,
      .mfp-wrap,
      div[class*="overlay"][class*="active"],
      div[id*="overlay"][class*="active"] {
        pointer-events: none !important;
      }
    `,
  });

  const closers = [
    '.mailpoet_form_popup_close',
    '.mailpoet_close',
    '.pum-close',
    '.mfp-close',
    '.modal-close, .close, button[aria-label="Close"]',
    '.mailpoet_form_popup_overlay',
    '.pum-overlay',
    '.mfp-bg',
  ];
  for (const sel of closers) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      try { await el.click({ timeout: 1000 }).catch(() => {}); } catch {}
    }
  }

  try { await page.keyboard.press("Escape"); } catch {}

  await page.evaluate(() => {
    const killers = [
      '.mailpoet_form_popup_overlay',
      '.mailpoet_form_popup',
      '#mp_form_popup1',
      '.pum-overlay', '.pum-container',
      '.mfp-bg', '.mfp-wrap',
      '.modal-backdrop', '.remodal-overlay', '.remodal-wrapper',
    ];
    for (const sel of killers) document.querySelectorAll(sel).forEach(n => n.remove());
  });
}

/* ================== コア処理：submitOnce ================== */
async function submitOnce(req: SubmitReq) {
  const { url, payload } = req;
  const host = domainOf(url);
  const started = Date.now();

  const ctx = await acquireContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  await page.route("**/*", async (route) => {
    const r = route.request();
    const t = r.resourceType();
    if (t === "image" || t === "font" || t === "media") return route.abort();

    const u = r.url();
    if (
      /\b(doubleclick|googletagmanager|google-analytics|facebook|twitter|pinterest|hotjar|mixpanel|segment)\b/i.test(u) ||
      /\b(adservice|adsystem|adserver|braze|intercom|sentry|datadog|newrelic)\b/i.test(u)
    ) return route.abort();

    return route.continue();
  });

  let anyCandidateFound = false;
  let lastShot: string | undefined;

  try {
    log("goto", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    const candidates = await Promise.race([
      findFormCandidates(page),
      page.waitForTimeout(FIND_TIMEOUT_MS).then(() => [] as Awaited<ReturnType<typeof findFormCandidates>>),
    ]);

    if (candidates.length) anyCandidateFound = true;

    for (const cand of candidates.slice(0, 3)) {
      const root = cand.root;
      const map = await mapFields(root);
      if (!map.email || !map.message || !map.submit) continue;

      await fillFields(map, payload);

      await neutralizeOverlays(page);
      try { await map.submit!.click({ force: true }); } catch {}
      try { await page.keyboard.press("Enter"); } catch {}

      try {
        await waitForSuccess(page, { timeoutMs: 12_000, settleMs: 500 });
      } catch {
        await neutralizeOverlays(page);
        try { await map.submit!.click({ force: true }); } catch {}
      }


      screenshotOnFail(page, url);

      const verdict = await waitForSuccess(page, { timeoutMs: 12_000, settleMs: 500 });
      if (verdict !== "fail") {
        return {
          status: "success" as const,
          verdict,
          url,
          host,
          ms: Date.now() - started,
        };
      }
    }
    lastShot = await screenshotBase64(page);

    if (!anyCandidateFound) {
      return {
        status: "fail" as const,
        verdict: "no_form_found",
        url, host,
        ms: Date.now() - started,
        screenshot: lastShot,
      };
    }
    return {
      status: "fail" as const,
      verdict: "no_success_signal",
      url, host,
      ms: Date.now() - started,
      screenshot: lastShot,
    };
  } catch (e: any) {
    log("error", e?.message || e);
    const shot = await screenshotBase64(page);
    return {
      status: "error" as const,
      error: String(e?.message ?? e),
      url, host,
      ms: Date.now() - started,
      screenshot: shot,
    };
  } finally {
    try { await page.close().catch(() => {}); } finally {
      await releaseContext(ctx);
    }
  }
}

/* ================== ルーティング ================== */
// 健康チェック
app.get("/health", (_req, res) => {
  // p-limit は activeCount/pendingCount を持つ（バージョンに依存）
  const g: any = globalLimit as any;
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    global: { active: g.activeCount ?? undefined, pending: g.pendingCount ?? undefined },
  });
});

// 1件送信（同期・順番待ち）
app.post("/submit", async (req, res) => {
  const parsed = SubmitReq.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", detail: parsed.error.flatten() });
  }
  const data = parsed.data;
  const host = domainOf(data.url);
  const domLimiter = domainLock(host);

  // キュー状況をヘッダで返す（目安）
  const g: any = globalLimit as any;
  const d: any = domLimiter as any;
  if (g?.pendingCount !== undefined) res.setHeader("X-Queue-Global-Pending", String(g.pendingCount));
  if (d?.pendingCount !== undefined) res.setHeader("X-Queue-Domain-Pending", String(d.pendingCount));

  try {
    const result = await globalLimit(() => domLimiter(() => submitOnce(data)));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: "internal_error", detail: String(e?.message ?? e) });
  }
});

// 複数送信（同期・順番待ち）
app.post("/submit/batch", async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(list)) return res.status(400).json({ error: "bad_request" });

  const jobs: SubmitReq[] = [];
  for (const it of list) {
    const p = SubmitReq.safeParse(it);
    if (p.success) jobs.push(p.data);
  }
  if (!jobs.length) return res.status(400).json({ error: "empty" });

  try {
    const results = await Promise.all(
      jobs.map((j) => {
        const dom = domainLock(domainOf(j.url));
        return globalLimit(() => dom(() => submitOnce(j)));
      })
    );
    res.json({ count: results.length, items: results });
  } catch (e: any) {
    res.status(500).json({ error: "internal_error", detail: String(e?.message ?? e) });
  }
});

/* ================== 起動 & 終了処理 ================== */
async function start() {
  await initBrowserIfNeeded(); // 事前にブラウザを温めておく
  server.listen(PORT, () => {
    console.log(
      `[submit] listening on http://localhost:${PORT} ` +
      `headless=true global=${GLOBAL_PARALLEL} per-domain=${PER_DOMAIN_PARALLEL} requestTimeoutMs=${REQUEST_TIMEOUT_MS}`
    );
  });
}
start().catch((e) => {
  console.error("[submit] failed to start:", e);
  process.exit(1);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`[submit] received ${sig}, shutting down...`);
    server.close(() => console.log("[submit] http server closed"));
    try { await shutdownBrowser(); } catch {}
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
