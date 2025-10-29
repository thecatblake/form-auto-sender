// src/browserPool.ts
import { chromium, Browser, BrowserContext, LaunchOptions } from "playwright";
import pLimit from "p-limit";

type CtxWrap = { ctx: BrowserContext; busy: boolean; createdAt: number; uses: number };

const MAX_CONTEXTS   = Number(process.env.POOL_MAX_CONTEXTS ?? 8);        // == GLOBAL_PARALLEL 以上にしない
const MAX_CTX_USES   = Number(process.env.POOL_MAX_CTX_USES ?? 50);       // 使い回し回数の上限
const CTX_TTL_MS     = Number(process.env.POOL_CTX_TTL_MS ?? 5 * 60_000); // 作成からの寿命
const ACQUIRE_TIMEOUT_MS = Number(process.env.POOL_ACQUIRE_TIMEOUT_MS ?? 15_000);

let browser: Browser | null = null;
const pool: CtxWrap[] = [];
const createLimit = pLimit(1); // コンテキスト生成はシリアルに

function launchArgs(): LaunchOptions {
  return {
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
      "--no-first-run",
      "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaSessionService,InterestCohort",
    ],
  };
}

export async function initBrowserIfNeeded() {
  if (!browser) {
    browser = await chromium.launch(launchArgs());
    // 予めいくつか温めておく（コールドスタート短縮）
    const warm = Math.min(2, MAX_CONTEXTS);
    for (let i = 0; i < warm; i++) await createContext();
    setInterval(sweepOldContexts, 30_000).unref(); // TTL 監視
  }
  return browser!;
}

async function createContext(): Promise<BrowserContext> {
  await initBrowserIfNeeded();
  const ctx = await browser!.newContext({
    bypassCSP: true,
    javaScriptEnabled: true,
    // ページ軽量化
    viewport: { width: 1200, height: 800 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
  });
  // キャッシュはプロセス間共有されないが、念のため
  await ctx.addInitScript(() => {
    // アニメーション抑制
    const style = document.createElement("style");
    style.innerHTML = `
      * { animation: none !important; transition: none !important; }
      html, body { scroll-behavior: auto !important; }
    `;
    document.head.appendChild(style);
  });
  pool.push({ ctx, busy: false, createdAt: Date.now(), uses: 0 });
  return ctx;
}

export async function acquireContext(): Promise<BrowserContext> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (true) {
    // 空き探す
    const free = pool.find((w) => !w.busy);
    if (free) {
      free.busy = true;
      return free.ctx;
    }
    // まだ作れるなら作る
    if (pool.length < MAX_CONTEXTS) {
      return await createLimit(async () => {
        const ctx = await createContext();
        const wrap = pool.find((w) => w.ctx === ctx)!;
        wrap.busy = true;
        return ctx;
      });
    }
    // タイムアウト監視
    if (Date.now() > deadline) throw new Error("acquire_context_timeout");
    // 少し待つ
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function releaseContext(ctx: BrowserContext) {
  const wrap = pool.find((w) => w.ctx === ctx);
  if (!wrap) {
    // 知らない ctx は閉じる
    await ctx.close().catch(() => {});
    return;
  }
  try {
    // データ痕跡を掃除（cookie/localStorage 等）
    await wrap.ctx.clearCookies();
    for (const page of wrap.ctx.pages()) {
      try { await page.close({ runBeforeUnload: false }); } catch {}
    }
  } finally {
    wrap.busy = false;
    wrap.uses += 1;

    // 老朽化したら作り直す
    if (wrap.uses >= MAX_CTX_USES || Date.now() - wrap.createdAt > CTX_TTL_MS) {
      wrap.busy = true;
      try { await wrap.ctx.close().catch(() => {}); } finally {
        const idx = pool.indexOf(wrap);
        if (idx >= 0) pool.splice(idx, 1);
        await createContext(); // 新品を補充（busy=false）
      }
    }
  }
}

function sweepOldContexts() {
  const now = Date.now();
  for (const wrap of [...pool]) {
    if (!wrap.busy && (now - wrap.createdAt > CTX_TTL_MS * 2)) {
      // 放置が長いものは閉じて削る
      wrap.busy = true;
      wrap.ctx.close().catch(() => {});
      const idx = pool.indexOf(wrap);
      if (idx >= 0) pool.splice(idx, 1);
    }
  }
}

export async function shutdown() {
  for (const w of pool) { try { await w.ctx.close(); } catch {} }
  pool.length = 0;
  if (browser) { try { await browser.close(); } catch {} }
  browser = null;
}
